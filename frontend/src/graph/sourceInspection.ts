import type { AtlasNode } from "../api";

type ExtractedFunctionWaypoint = NonNullable<NonNullable<AtlasNode["metadata"]>["functionWaypoints"]>[number];

export type FunctionGroupLabel = "Exports" | "Declarations" | "Methods" | "Hook Callbacks";

export interface SourceFunctionWaypoint extends ExtractedFunctionWaypoint {
  id: string;
  lineCount: number;
  group: FunctionGroupLabel;
}

export interface SourceFunctionGroup {
  label: FunctionGroupLabel;
  functions: SourceFunctionWaypoint[];
}

export interface SourceSectionAnchor {
  id: string;
  label: string;
  line: number;
  detail: string;
}

export interface SourceInspection {
  sections: SourceSectionAnchor[];
  functions: SourceFunctionWaypoint[];
  groups: SourceFunctionGroup[];
}

const FUNCTION_GROUP_ORDER: FunctionGroupLabel[] = [
  "Exports",
  "Declarations",
  "Methods",
  "Hook Callbacks"
];

function functionGroup(waypoint: ExtractedFunctionWaypoint): FunctionGroupLabel {
  if (waypoint.exported) {
    return "Exports";
  }

  if (waypoint.kind === "method" || waypoint.kind === "accessor" || waypoint.kind === "constructor") {
    return "Methods";
  }

  if (waypoint.kind === "effect") {
    return "Hook Callbacks";
  }

  return "Declarations";
}

function sourceAnchor(
  lines: string[],
  id: string,
  label: string,
  predicate: (line: string) => boolean
): SourceSectionAnchor | null {
  const matchingLines = lines.flatMap((line, index) => (predicate(line) ? [index + 1] : []));

  if (matchingLines.length === 0) {
    return null;
  }

  return {
    id,
    label,
    line: matchingLines[0],
    detail: `${matchingLines.length} marker${matchingLines.length === 1 ? "" : "s"}`
  };
}

export function inspectSource(file: AtlasNode): SourceInspection {
  const sourceLines = typeof file.sourceText === "string" ? file.sourceText.split(/\r?\n/) : [];
  const functions = (file.metadata?.functionWaypoints ?? []).map((waypoint, index) => ({
    ...waypoint,
    id: `function-${index}-${waypoint.startLine}`,
    lineCount: Math.max(1, waypoint.endLine - waypoint.startLine + 1),
    group: functionGroup(waypoint)
  }));
  const sections = [
    sourceAnchor(sourceLines, "imports", "Imports", (line) => /^\s*import\b/.test(line)),
    sourceAnchor(sourceLines, "state", "State", (line) => /\buse(?:State|Reducer|Ref|Context)\s*\(/.test(line)),
    sourceAnchor(sourceLines, "effects", "Effects", (line) => /\buse(?:Effect|LayoutEffect)\s*\(/.test(line)),
    sourceAnchor(sourceLines, "exports", "Exports", (line) => /^\s*export\b/.test(line))
  ].filter((anchor): anchor is SourceSectionAnchor => anchor !== null);
  const groups = FUNCTION_GROUP_ORDER.flatMap((label): SourceFunctionGroup[] => {
    const groupedFunctions = functions.filter((waypoint) => waypoint.group === label);

    return groupedFunctions.length > 0 ? [{ label, functions: groupedFunctions }] : [];
  });

  return {
    sections,
    functions,
    groups
  };
}
