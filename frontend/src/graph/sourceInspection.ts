import type { AtlasNode } from "../api";

type ExtractedFunctionWaypoint = NonNullable<NonNullable<AtlasNode["metadata"]>["functionWaypoints"]>[number];
type ExtractedVariableWaypoint = NonNullable<NonNullable<AtlasNode["metadata"]>["variableWaypoints"]>[number];

export type FunctionGroupLabel = "Exports" | "Declarations" | "Methods" | "Hook Callbacks";
export type ConcernKind = "rendering" | "runtime" | "state" | "event" | "transformation" | "utility";
export type GravityLevel = "low" | "medium" | "high";
export type VariableClassification =
  | "State Surface"
  | "Runtime Handle"
  | "Derived Projection"
  | "Structural Config"
  | "Local Helper"
  | "Temporary Iterator"
  | "Data Transform"
  | "Render Projection";

interface PressureSignals {
  density: number;
  rendering: number;
  runtime: number;
  state: number;
  dependency: number;
}

export interface SourceFunctionWaypoint extends ExtractedFunctionWaypoint {
  id: string;
  lineCount: number;
  group: FunctionGroupLabel;
  concerns: ConcernKind[];
  gravityLevel: GravityLevel;
  gravityScore: number;
  pressure: PressureSignals;
}

export interface SourceFunctionGroup {
  label: FunctionGroupLabel;
  functions: SourceFunctionWaypoint[];
}

export interface SourceVariableWaypoint extends ExtractedVariableWaypoint {
  id: string;
  classification: VariableClassification;
  operational: boolean;
  score: number;
}

export interface SourceSectionAnchor {
  id: string;
  label: string;
  line: number;
  detail: string;
}

export interface OperationalCompositionEntry {
  kind: ConcernKind;
  percentage: number;
}

export type OperationalIdentityKind = ConcernKind | "configuration" | "support" | "unclassified";

export interface OperationalIdentityTrait {
  kind: ConcernKind | "dependency" | "weight";
  label: string;
}

export interface OperationalIdentityContext {
  importCount: number;
  importedByCount: number;
  weight?: "LOW" | "MEDIUM" | "HIGH";
}

export interface OperationalIdentity {
  kind: OperationalIdentityKind;
  primaryRole: string;
  secondaryTraits: OperationalIdentityTrait[];
}

export interface SourceInspection {
  sections: SourceSectionAnchor[];
  functions: SourceFunctionWaypoint[];
  groups: SourceFunctionGroup[];
  operationalVariables: SourceVariableWaypoint[];
  localVariables: SourceVariableWaypoint[];
  composition: OperationalCompositionEntry[];
}

const FUNCTION_GROUP_ORDER: FunctionGroupLabel[] = [
  "Exports",
  "Declarations",
  "Methods",
  "Hook Callbacks"
];
const CONCERN_ORDER: ConcernKind[] = ["rendering", "runtime", "state", "event", "transformation", "utility"];
const TRANSFORMATION_CALL = /(?:^|\.)(?:map|flatMap|filter|reduce|sort|groupBy|fromEntries|entries|assign|parse|stringify)$/;
const RUNTIME_TOKEN = /\b(?:runtime|xray|x-ray|corridor|scrub|replay|playback)\b/i;
const JSX_TOKEN = /<\/?[A-Za-z][A-Za-z0-9.:_-]*(?:\s|\/?>)/;
const STRUCTURAL_CONFIG_TOKEN = /(?:config|option|setting|layout|theme|threshold|limit|palette|style)/i;
const TRANSFORM_VARIABLE_TOKEN = /(?:transform|mapped|filtered|sorted|grouped|result|resolved|relation|score|projection)/i;
const TEMPORARY_VARIABLE_TOKEN = /^(?:i|j|k|index|idx|key|item|entry|cursor)$/i;

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

function concernSignals(waypoint: ExtractedFunctionWaypoint, source: string, filePath: string): ConcernKind[] {
  const concerns: ConcernKind[] = [];
  const crossFileCalls = waypoint.calls.filter(
    (call) => Boolean(call.definitionPath) && call.definitionPath !== filePath
  );

  if (JSX_TOKEN.test(source) || waypoint.calls.some((call) => /(?:^|\.)createElement$/.test(call.name))) {
    concerns.push("rendering");
  }

  if (RUNTIME_TOKEN.test(`${waypoint.name}\n${source}`)) {
    concerns.push("runtime");
  }

  if (waypoint.stateUpdates.length > 0 || /\buse(?:State|Reducer)\s*\(/.test(source)) {
    concerns.push("state");
  }

  if (/^(?:handle[A-Z]|on[A-Z])/.test(waypoint.name) || waypoint.inputs.some((input) => /event/i.test(input.name))) {
    concerns.push("event");
  }

  if (waypoint.calls.some((call) => TRANSFORMATION_CALL.test(call.name))) {
    concerns.push("transformation");
  }

  if (concerns.length === 0 && crossFileCalls.length === 0) {
    concerns.push("utility");
  }

  return concerns.length > 0 ? concerns : ["utility"];
}

function pressureFor(
  waypoint: ExtractedFunctionWaypoint,
  lineCount: number,
  concerns: ConcernKind[],
  filePath: string
): PressureSignals {
  const crossFileCalls = waypoint.calls.filter(
    (call) => Boolean(call.definitionPath) && call.definitionPath !== filePath
  ).length;
  const operationalScore =
    lineCount +
    waypoint.calls.length * 3 +
    waypoint.stateUpdates.length * 6 +
    crossFileCalls * 5 +
    Number(waypoint.exported) * 4;

  return {
    density: Math.min(1, 0.18 + operationalScore / 90),
    rendering: concerns.includes("rendering") ? Math.min(1, 0.4 + lineCount / 90) : 0,
    runtime: concerns.includes("runtime") ? Math.min(1, 0.4 + lineCount / 90) : 0,
    state: waypoint.stateUpdates.length > 0 ? Math.min(1, 0.34 + waypoint.stateUpdates.length / 8) : 0,
    dependency: crossFileCalls > 0 ? Math.min(1, 0.34 + crossFileCalls / 6) : 0
  };
}

function gravityFor(waypoint: ExtractedFunctionWaypoint, lineCount: number): { level: GravityLevel; score: number } {
  const score =
    lineCount +
    waypoint.calls.length * 4 +
    waypoint.stateUpdates.length * 8 +
    Number(Boolean(waypoint.exported || waypoint.public)) * 12;

  return {
    score,
    level: score >= 70 ? "high" : score >= 26 ? "medium" : "low"
  };
}

function variableClassification(variable: ExtractedVariableWaypoint): VariableClassification {
  if (variable.declarationKind === "state") {
    return "State Surface";
  }

  if (variable.declarationKind === "ref" || variable.runtimeRelated) {
    return "Runtime Handle";
  }

  if (variable.renderingLines.length > 0) {
    return "Render Projection";
  }

  if (STRUCTURAL_CONFIG_TOKEN.test(variable.name)) {
    return "Structural Config";
  }

  if (variable.helperCallLines.length >= 2 || TRANSFORM_VARIABLE_TOKEN.test(variable.name)) {
    return "Data Transform";
  }

  if (variable.conditionLines.length > 0) {
    return "Derived Projection";
  }

  if (variable.declarationKind === "iterator" || TEMPORARY_VARIABLE_TOKEN.test(variable.name)) {
    return "Temporary Iterator";
  }

  return "Local Helper";
}

function variableScore(variable: ExtractedVariableWaypoint): number {
  const involvedRegions = [
    variable.mutationLines,
    variable.conditionLines,
    variable.renderingLines,
    variable.helperCallLines
  ].filter((lines) => lines.length > 0).length;

  return (
    Number(variable.declarationKind === "state") * 9 +
    Number(variable.declarationKind === "ref") * 8 +
    Number(variable.runtimeRelated) * 7 +
    Number(variable.usageLines.length >= 5) * 3 +
    Math.min(4, involvedRegions * 2) +
    Number(variable.renderingLines.length > 0) * 2 +
    Number(variable.helperCallLines.length >= 2) * 3
  );
}

function sourceVariables(file: AtlasNode): {
  operationalVariables: SourceVariableWaypoint[];
  localVariables: SourceVariableWaypoint[];
} {
  const variables = (file.metadata?.variableWaypoints ?? []).map((variable) => {
    const score = variableScore(variable);
    const operational =
      variable.declarationKind === "state" ||
      variable.declarationKind === "ref" ||
      variable.runtimeRelated ||
      score >= 7;

    return {
      ...variable,
      id: variable.variableId,
      classification: variableClassification(variable),
      operational,
      score
    };
  });

  return {
    operationalVariables: variables
      .filter((variable) => variable.operational)
      .sort((left, right) => right.score - left.score || right.usageLines.length - left.usageLines.length || left.declarationLine - right.declarationLine),
    localVariables: variables
      .filter((variable) => !variable.operational)
      .sort((left, right) => left.declarationLine - right.declarationLine || left.name.localeCompare(right.name))
  };
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

function compositionFor(functions: SourceFunctionWaypoint[]): OperationalCompositionEntry[] {
  const rawWeights = new Map<ConcernKind, number>();

  for (const waypoint of functions) {
    const distributedWeight = waypoint.lineCount / waypoint.concerns.length;

    for (const concern of waypoint.concerns) {
      rawWeights.set(concern, (rawWeights.get(concern) ?? 0) + distributedWeight);
    }
  }

  const total = [...rawWeights.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return [];
  }

  const entries = CONCERN_ORDER.flatMap((kind) => {
    const value = rawWeights.get(kind);

    return value === undefined
      ? []
      : [{
          kind,
          exactPercentage: (value / total) * 100,
          percentage: Math.floor((value / total) * 100)
        }];
  });
  let remaining = 100 - entries.reduce((sum, entry) => sum + entry.percentage, 0);

  entries
    .slice()
    .sort((a, b) => (b.exactPercentage % 1) - (a.exactPercentage % 1) || CONCERN_ORDER.indexOf(a.kind) - CONCERN_ORDER.indexOf(b.kind))
    .forEach((entry) => {
      if (remaining > 0) {
        entry.percentage += 1;
        remaining -= 1;
      }
    });

  return entries
    .sort((a, b) => b.percentage - a.percentage || CONCERN_ORDER.indexOf(a.kind) - CONCERN_ORDER.indexOf(b.kind))
    .map(({ kind, percentage }) => ({ kind, percentage }));
}

function conventionalIdentityKind(file: AtlasNode): OperationalIdentityKind | null {
  const label = file.label.toLowerCase();
  const extension = String(file.metadata?.extension ?? "").toLowerCase();
  const stem = extension && label.endsWith(extension) ? label.slice(0, -extension.length) : label;

  if (stem === "config" || stem === "configuration" || stem.endsWith(".config")) {
    return "configuration";
  }

  if (
    ["types", "constants"].includes(stem) ||
    file.metadata?.compressionReasons?.includes("pass-through-export") ||
    file.metadata?.compressionReasons?.includes("package-gateway") ||
    file.metadata?.compressionReasons?.includes("conventional-support-file")
  ) {
    return "support";
  }

  return null;
}

function primaryRoleFor(kind: OperationalIdentityKind): string {
  switch (kind) {
    case "rendering":
      return "Primary rendering surface";
    case "runtime":
      return "Runtime-related coordination surface";
    case "state":
      return "State management surface";
    case "event":
      return "Event handling surface";
    case "transformation":
      return "Data shaping layer";
    case "utility":
      return "Utility/helper layer";
    case "configuration":
      return "Configuration/support file";
    case "support":
      return "Structural support file";
    default:
      return "Unclassified source surface";
  }
}

function secondaryTraitFor(entry: OperationalCompositionEntry): OperationalIdentityTrait | null {
  if (entry.percentage < 12) {
    return null;
  }

  const level = entry.percentage >= 35 ? "High" : entry.percentage >= 18 ? "Moderate" : "Light";
  const labels: Record<ConcernKind, string> = {
    rendering: "visual structure",
    runtime: "runtime-related structure",
    state: "state activity",
    event: "event handling",
    transformation: "data shaping",
    utility: "helper abstraction"
  };

  return {
    kind: entry.kind,
    label: `${level} ${labels[entry.kind]}`
  };
}

export function operationalIdentityFor(
  file: AtlasNode,
  inspection: SourceInspection,
  context: OperationalIdentityContext
): OperationalIdentity {
  const conventionalKind = conventionalIdentityKind(file);
  const primaryComposition = inspection.composition[0];
  const kind = conventionalKind ?? primaryComposition?.kind ?? "unclassified";
  const secondaryTraits = inspection.composition
    .filter((entry) => entry.kind !== kind)
    .map(secondaryTraitFor)
    .filter((trait): trait is OperationalIdentityTrait => trait !== null);

  if (context.importedByCount >= 5) {
    secondaryTraits.push({
      kind: "dependency",
      label: `Used by ${context.importedByCount} indexed files`
    });
  } else if (context.importCount >= 8) {
    secondaryTraits.push({
      kind: "dependency",
      label: "Broad outgoing dependency surface"
    });
  }

  if (secondaryTraits.length === 0 && context.weight === "LOW") {
    secondaryTraits.push({
      kind: "weight",
      label: "Low architectural weight"
    });
  }

  return {
    kind,
    primaryRole: primaryRoleFor(kind),
    secondaryTraits: secondaryTraits.slice(0, 3)
  };
}

export function inspectSource(file: AtlasNode): SourceInspection {
  const sourceLines = typeof file.sourceText === "string" ? file.sourceText.split(/\r?\n/) : [];
  const isPython = String(file.metadata?.extension ?? "").toLowerCase() === ".py";
  const functions = (file.metadata?.functionWaypoints ?? []).map((waypoint, index) => {
    const lineCount = Math.max(1, waypoint.endLine - waypoint.startLine + 1);
    const source = sourceLines.slice(waypoint.startLine - 1, waypoint.endLine).join("\n");
    const concerns = concernSignals(waypoint, source, file.path);
    const gravity = gravityFor(waypoint, lineCount);

    return {
      ...waypoint,
      id: waypoint.waypointId ?? `function-${index}-${waypoint.startLine}`,
      lineCount,
      group: functionGroup(waypoint),
      concerns,
      gravityLevel: gravity.level,
      gravityScore: gravity.score,
      pressure: pressureFor(waypoint, lineCount, concerns, file.path)
    };
  });
  const sections = [
    sourceAnchor(sourceLines, "imports", "Imports", (line) => isPython
      ? /^\s*(?:from\s+[\w.]+\s+import\b|import\b)/.test(line)
      : /^\s*import\b/.test(line)),
    isPython ? sourceAnchor(sourceLines, "classes", "Classes", (line) => /^\s*class\s+[A-Za-z_]\w*/.test(line)) : null,
    isPython ? null : sourceAnchor(sourceLines, "state", "State", (line) => /\buse(?:State|Reducer|Ref|Context)\s*\(/.test(line)),
    isPython ? null : sourceAnchor(sourceLines, "effects", "Effects", (line) => /\buse(?:Effect|LayoutEffect)\s*\(/.test(line)),
    isPython ? null : sourceAnchor(sourceLines, "exports", "Exports", (line) => /^\s*export\b/.test(line))
  ].filter((anchor): anchor is SourceSectionAnchor => anchor !== null);
  const groups = FUNCTION_GROUP_ORDER.flatMap((label): SourceFunctionGroup[] => {
    const groupedFunctions = functions.filter((waypoint) => waypoint.group === label);

    return groupedFunctions.length > 0 ? [{ label, functions: groupedFunctions }] : [];
  });
  const variables = sourceVariables(file);

  return {
    sections,
    functions,
    groups,
    ...variables,
    composition: compositionFor(functions)
  };
}
