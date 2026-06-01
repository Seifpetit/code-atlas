import {
  lazy,
  Suspense,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { AtlasNode } from "../api";
import {
  inspectSource,
  type SourceFunctionWaypoint,
  type SourceSectionAnchor,
  type SourceVariableWaypoint
} from "./sourceInspection";
import { highlightSource, sourceLanguageLabel, type HighlightedSource } from "./sourceSyntaxHighlighting";

const RenderedMarkdown = lazy(() =>
  import("./RenderedMarkdown").then((module) => ({ default: module.RenderedMarkdown }))
);

export interface SourceRuntimeContext {
  inActiveCorridor: boolean;
  isCurrentNode: boolean;
  exploredAsOrigin: boolean;
  runtimeStep?: number;
}

export interface SourceFileContext {
  importCount: number;
  importedByCount: number;
  weight?: "LOW" | "MEDIUM" | "HIGH";
  commitCount?: number;
  lastModified?: string;
}

interface SourceCodeModalProps {
  file: AtlasNode;
  sourceFiles?: AtlasNode[];
  runtimeContext?: SourceRuntimeContext;
  fileContext?: SourceFileContext;
  onClose: () => void;
}

interface LineRange {
  startLine: number;
  endLine: number;
}

type SourceStyle = CSSProperties & Record<`--${string}`, string | number>;
type MarkdownDisplayMode = "rendered" | "raw";

type CirculationRegion = "inputs" | "outputs" | "state-updates" | "calls";

interface RuntimePlacementRelation {
  id: string;
  name: string;
  path: string;
  isCrossFile: boolean;
  connectionKind: "call" | "jsx-render";
  isModuleScope?: boolean;
}

interface RuntimePlacementModel {
  incoming: RuntimePlacementRelation[];
  incomingOverflow: number;
  outgoing: RuntimePlacementRelation[];
  outgoingOverflow: number;
}

interface SourceOutlineItem {
  id: string;
  name?: string;
  label?: string;
  line: number;
  iconLabel: string;
  detail?: string;
  tags?: string[];
  active?: boolean;
}

interface SourceOutlineGroup {
  id: string;
  label: string;
  icon: string;
  iconClassName: string;
  items: SourceOutlineItem[];
}

type VariableScopeTier = "app-wide" | "shared" | "local";

interface VariableOutlineItem {
  id: string;
  name: string;
  line: number;
  scopeTier: VariableScopeTier;
  typeTag: {
    label: string;
    className: string;
  };
  blastRadius: number;
  pipFillCount: number;
}

interface VariableOutlineGroup {
  id: VariableScopeTier;
  label: string;
  edgeClassName: string;
  items: VariableOutlineItem[];
}

const SOURCE_RAIL_MIN_WIDTH = 235;
const SOURCE_RAIL_MAX_WIDTH = 460;
const SOURCE_RAIL_INITIAL_WIDTH = 300;
const RUNTIME_PLACEMENT_INCOMING_LIMIT = 3;
const RUNTIME_PLACEMENT_OUTGOING_LIMIT = 2;

function clampSourceRailWidth(width: number): number {
  return Math.max(SOURCE_RAIL_MIN_WIDTH, Math.min(SOURCE_RAIL_MAX_WIDTH, width));
}

function variableOccurrenceLines(variable: SourceVariableWaypoint): number[] {
  return [...new Set([
    variable.declarationLine,
    ...variable.usageLines,
    ...variable.mutationLines,
    ...variable.conditionLines,
    ...variable.renderingLines,
    ...variable.helperCallLines
  ])].sort((left, right) => left - right);
}

function variableScopeTierFor(variable: SourceVariableWaypoint): VariableScopeTier {
  const reach = variable.usageLines.length + variable.mutationLines.length + variable.conditionLines.length + variable.renderingLines.length + variable.helperCallLines.length;

  if (variable.declarationKind === "state" || variable.declarationKind === "ref" || reach >= 6) {
    return "app-wide";
  }

  if (reach >= 2) {
    return "shared";
  }

  return "local";
}

function variableBlastRadiusFor(variable: SourceVariableWaypoint): number {
  const reach = variable.usageLines.length + variable.mutationLines.length + variable.conditionLines.length + variable.renderingLines.length + variable.helperCallLines.length;

  if (variable.declarationKind === "state" || variable.declarationKind === "ref") {
    return Math.min(4, Math.max(2, Math.ceil(reach / 2) + 1));
  }

  return Math.min(4, reach <= 1 ? 0 : reach === 2 ? 1 : reach <= 4 ? 2 : reach <= 7 ? 3 : 4);
}

function variableTypeTagFor(variable: SourceVariableWaypoint, declarationSourceLine: string): { label: string; className: string } {
  if (/useContext\s*\(/.test(declarationSourceLine)) {
    return { label: "ctx", className: "is-context" };
  }

  if (variable.declarationKind === "state") {
    return { label: "useState", className: "is-state" };
  }

  if (variable.declarationKind === "ref") {
    return { label: "useRef", className: "is-ref" };
  }

  if (variable.declarationKind === "let" || variable.declarationKind === "var") {
    return { label: "let", className: "is-let" };
  }

  return { label: "const", className: "is-const" };
}

function variableEdgeClassName(tier: VariableScopeTier): string {
  return tier === "app-wide" ? "is-app-wide" : tier === "shared" ? "is-shared" : "is-local";
}

function variablePipColorClass(blastRadius: number): string {
  if (blastRadius >= 4) {
    return "is-red";
  }

  if (blastRadius >= 2) {
    return "is-amber";
  }

  if (blastRadius >= 1) {
    return "is-cyan";
  }

  return "is-dark";
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileExtensionLabel(fileLabel: string): string | null {
  const lastDot = fileLabel.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileLabel.length - 1) {
    return null;
  }

  return fileLabel.slice(lastDot);
}

function fileStemLabel(fileLabel: string): string {
  const lastDot = fileLabel.lastIndexOf(".");
  return lastDot > 0 ? fileLabel.slice(0, lastDot) : fileLabel;
}

function isPythonSource(extension?: string): boolean {
  return String(extension ?? "").toLowerCase() === ".py";
}

function splitCommaList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseImportNames(sourceText: string, extension?: string): Array<{ name: string; line: number; detail?: string }> {
  const rows: Array<{ name: string; line: number; detail?: string }> = [];
  const lines = sourceText.split(/\r?\n/);
  const python = isPythonSource(extension);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*") || line.startsWith("#")) {
      continue;
    }

    if (python) {
      const fromMatch = line.match(/^from\s+[\w.]+\s+import\s+(.+)$/);
      if (fromMatch) {
        const imported = fromMatch[1].replace(/[()]/g, "").replace(/\\$/, "").trim();
        for (const entry of splitCommaList(imported)) {
          const alias = entry.match(/^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)$/);
          const name = alias ? alias[2] : entry;
          rows.push({ name, line: index + 1, detail: alias ? alias[1] : undefined });
        }
        continue;
      }

      const importMatch = line.match(/^import\s+(.+)$/);
      if (importMatch) {
        for (const entry of splitCommaList(importMatch[1])) {
          const alias = entry.match(/^([A-Za-z_][\w.]*)\s+as\s+([A-Za-z_]\w*)$/);
          rows.push({ name: alias ? alias[2] : entry, line: index + 1, detail: alias ? alias[1] : undefined });
        }
      }

      continue;
    }

    const sideEffectMatch = line.match(/^import\s+["']([^"']+)["']\s*;?$/);
    if (sideEffectMatch) {
      const specifier = sideEffectMatch[1];
      const fileName = specifier.split("/").pop() ?? specifier;
      rows.push({ name: fileName, line: index + 1, detail: specifier });
      continue;
    }

    const importMatch = line.match(/^import\s+(type\s+)?(.+)$/);
    if (importMatch) {
      const clause = importMatch[2];
      const fromSplit = clause.split(/\s+from\s+/);
      const left = fromSplit[0].trim();

      if (left.startsWith("* as ")) {
        rows.push({ name: left.slice(5).trim(), line: index + 1, detail: "namespace" });
        continue;
      }

      if (left.startsWith("{")) {
        for (const entry of splitCommaList(left.replace(/[{}]/g, ""))) {
          const alias = entry.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          rows.push({ name: alias ? alias[2] : entry, line: index + 1, detail: alias ? alias[1] : undefined });
        }
        continue;
      }

      if (left.includes(",")) {
        const [defaultImport, rest] = left.split(",", 2);
        const trimmedDefault = defaultImport.trim();
        if (trimmedDefault.length > 0) {
          rows.push({ name: trimmedDefault, line: index + 1, detail: "default" });
        }

        const braceMatch = rest?.match(/\{([\s\S]+)\}/);
        if (braceMatch) {
          for (const entry of splitCommaList(braceMatch[1])) {
            const alias = entry.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
            rows.push({ name: alias ? alias[2] : entry, line: index + 1, detail: alias ? alias[1] : undefined });
          }
        }

        continue;
      }

      if (left.length > 0) {
        rows.push({ name: left, line: index + 1, detail: "default" });
      }
    }
  }

  return rows;
}

function outlineSearchText(item: Pick<SourceOutlineItem, "name" | "label" | "line" | "detail" | "tags">): string {
  return [item.name ?? item.label ?? "", String(item.line), item.detail ?? "", ...(item.tags ?? [])].join(" ").toLowerCase();
}

function sourceOutlineMatchesQuery(item: Pick<SourceOutlineItem, "name" | "label" | "line" | "detail" | "tags">, query: string): boolean {
  if (query.length === 0) {
    return true;
  }

  return outlineSearchText(item).includes(query);
}

function compareRuntimePlacementRelations(left: RuntimePlacementRelation, right: RuntimePlacementRelation): number {
  return Number(left.isCrossFile) - Number(right.isCrossFile)
    || left.path.localeCompare(right.path)
    || left.name.localeCompare(right.name);
}

function runtimePlacementFor(
  file: AtlasNode,
  focusedFunction: SourceFunctionWaypoint,
  sourceFiles: AtlasNode[]
): RuntimePlacementModel {
  const indexedFiles = new Map(sourceFiles.map((sourceFile) => [sourceFile.path, sourceFile]));
  indexedFiles.set(file.path, file);
  const incomingById = new Map<string, RuntimePlacementRelation>();
  const outgoingById = new Map<string, RuntimePlacementRelation>();
  const waypointForTarget = (
    filePath: string,
    definitionWaypointId?: string,
    definitionName?: string,
    definitionStartLine?: number,
    definitionEndLine?: number
  ) => {
    const waypoints = indexedFiles.get(filePath)?.metadata?.functionWaypoints ?? [];
    if (definitionWaypointId) {
      return waypoints.find((waypoint) => waypoint.waypointId === definitionWaypointId) ?? null;
    }

    if (definitionStartLine !== undefined && definitionEndLine !== undefined) {
      const bySpan = waypoints.filter(
        (waypoint) => waypoint.startLine === definitionStartLine && waypoint.endLine === definitionEndLine
      );

      if (bySpan.length === 1) {
        return bySpan[0];
      }
    }

    const matches = definitionName ? waypoints.filter((waypoint) => waypoint.name === definitionName) : [];
    return matches.length === 1 ? matches[0] : null;
  };
  const indexedFocusedFunction = waypointForTarget(
    file.path,
    focusedFunction.waypointId,
    focusedFunction.name,
    focusedFunction.startLine,
    focusedFunction.endLine
  );

  if (indexedFocusedFunction?.startLine === focusedFunction.startLine) {
    for (const sourceFile of indexedFiles.values()) {
      for (const caller of sourceFile.metadata?.functionWaypoints ?? []) {
        const incomingConnection = caller.calls.find(
          (call) =>
            call.definitionPath === file.path &&
            (
              (focusedFunction.waypointId && call.definitionWaypointId === focusedFunction.waypointId) ||
              (
                call.definitionStartLine === focusedFunction.startLine &&
                call.definitionEndLine === focusedFunction.endLine
              ) ||
              (
                !call.definitionWaypointId &&
                !call.definitionStartLine &&
                !call.definitionEndLine &&
                call.definitionName === focusedFunction.name
              )
            )
        );

        if (incomingConnection) {
          const id = `${sourceFile.path}:${caller.startLine}:${caller.name}`;
          incomingById.set(id, {
            id,
            name: caller.name,
            path: sourceFile.path,
            isCrossFile: sourceFile.path !== file.path,
            connectionKind: incomingConnection.connectionKind ?? "call"
          });
        }
      }

      const moduleConnection = sourceFile.metadata?.moduleLinks?.find(
        (call) =>
          call.definitionPath === file.path &&
          (
            (focusedFunction.waypointId && call.definitionWaypointId === focusedFunction.waypointId) ||
            (
              call.definitionStartLine === focusedFunction.startLine &&
              call.definitionEndLine === focusedFunction.endLine
            ) ||
            (
              !call.definitionWaypointId &&
              !call.definitionStartLine &&
              !call.definitionEndLine &&
              call.definitionName === focusedFunction.name
            )
          )
      );
      if (moduleConnection) {
        const id = `${sourceFile.path}:module-scope`;
        incomingById.set(id, {
          id,
          name: "Module Scope",
          path: sourceFile.path,
          isCrossFile: sourceFile.path !== file.path,
          connectionKind: moduleConnection.connectionKind ?? "call",
          isModuleScope: true
        });
      }
    }
  }

  for (const call of focusedFunction.calls) {
    if (!call.definitionPath || !call.definitionName) {
      continue;
    }

    const targetFunction = waypointForTarget(
      call.definitionPath,
      call.definitionWaypointId,
      call.definitionName,
      call.definitionStartLine,
      call.definitionEndLine
    );
    if (!targetFunction) {
      continue;
    }

    const id = call.definitionWaypointId
      ? `${call.definitionPath}:${call.definitionWaypointId}`
      : call.definitionStartLine !== undefined && call.definitionEndLine !== undefined
        ? `${call.definitionPath}:${call.definitionStartLine}:${call.definitionEndLine}`
        : `${call.definitionPath}:${call.definitionName}`;
    outgoingById.set(id, {
      id,
      name: targetFunction.name,
      path: call.definitionPath,
      isCrossFile: call.definitionPath !== file.path,
      connectionKind: call.connectionKind ?? "call"
    });
  }

  const incoming = [...incomingById.values()].sort(compareRuntimePlacementRelations);
  const outgoing = [...outgoingById.values()].sort(compareRuntimePlacementRelations);

  return {
    incoming: incoming.slice(0, RUNTIME_PLACEMENT_INCOMING_LIMIT),
    incomingOverflow: Math.max(0, incoming.length - RUNTIME_PLACEMENT_INCOMING_LIMIT),
    outgoing: outgoing.slice(0, RUNTIME_PLACEMENT_OUTGOING_LIMIT),
    outgoingOverflow: Math.max(0, outgoing.length - RUNTIME_PLACEMENT_OUTGOING_LIMIT)
  };
}

interface CirculationSectionProps {
  title: string;
  summary: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function CirculationSection({ title, summary, isExpanded, onToggle, children }: CirculationSectionProps) {
  return (
    <section className={`source-modal__flow-section ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
      <button type="button" className="source-modal__flow-toggle" aria-expanded={isExpanded} onClick={onToggle}>
        <span>{title}</span>
        <small>{summary}</small>
        <i aria-hidden="true" />
      </button>
      {isExpanded ? <div className="source-modal__flow-entries">{children}</div> : null}
    </section>
  );
}

export function SourceCodeModal({ file, sourceFiles = [], runtimeContext, fileContext, onClose }: SourceCodeModalProps) {
  const sourceText = typeof file.sourceText === "string" ? file.sourceText : null;
  const sourceLines = useMemo(() => (sourceText === null ? [] : sourceText.split(/\r?\n/)), [sourceText]);
  const inspection = useMemo(() => inspectSource(file), [file]);
  const isMarkdownFile = String(file.metadata?.extension ?? "").toLowerCase() === ".md";
  const [highlightedSource, setHighlightedSource] = useState<HighlightedSource | null>(null);
  const [markdownDisplayMode, setMarkdownDisplayMode] = useState<MarkdownDisplayMode>("rendered");
  const [activeFunctionId, setActiveFunctionId] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<LineRange | null>(null);
  const [areImportsExpanded, setAreImportsExpanded] = useState(true);
  const [areFunctionWaypointsExpanded, setAreFunctionWaypointsExpanded] = useState(true);
  const [areVariablesExpanded, setAreVariablesExpanded] = useState(true);
  const [areAppWideVariablesExpanded, setAreAppWideVariablesExpanded] = useState(true);
  const [areSharedVariablesExpanded, setAreSharedVariablesExpanded] = useState(true);
  const [areLocalVariablesExpanded, setAreLocalVariablesExpanded] = useState(false);
  const [areSectionsExpanded, setAreSectionsExpanded] = useState(false);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [expandedCirculationRegion, setExpandedCirculationRegion] = useState<CirculationRegion | null>("inputs");
  const [foldedFunctionIds, setFoldedFunctionIds] = useState<Set<string>>(() => new Set());
  const [runtimePlacementFunctionId, setRuntimePlacementFunctionId] = useState<string | null>(null);
  const [activeVariableId, setActiveVariableId] = useState<string | null>(null);
  const [activeVariableOccurrenceLine, setActiveVariableOccurrenceLine] = useState<number | null>(null);
  const [railWidth, setRailWidth] = useState(SOURCE_RAIL_INITIAL_WIDTH);
  const [isResizingRail, setIsResizingRail] = useState(false);
  const lineRefs = useRef(new Map<number, HTMLSpanElement>());
  const railResizeOriginRef = useRef<{ pointerX: number; width: number } | null>(null);
  const languageLabel = sourceLanguageLabel(file.metadata?.extension);
  const totalFunctionCount = file.metadata?.functionCount ?? inspection.functions.length;
  const importRows = useMemo(
    () => parseImportNames(sourceText ?? "", file.metadata?.extension),
    [file.metadata?.extension, sourceText]
  );
  const activeFunction = inspection.functions.find((waypoint) => waypoint.id === activeFunctionId) ?? null;
  const activeVariable = [...inspection.operationalVariables, ...inspection.localVariables]
    .find((variable) => variable.id === activeVariableId) ?? null;
  const activeVariableOccurrences = useMemo(
    () => activeVariable ? variableOccurrenceLines(activeVariable) : [],
    [activeVariable]
  );
  const activeVariableOccurrenceIndex = activeVariableOccurrenceLine === null
    ? -1
    : activeVariableOccurrences.indexOf(activeVariableOccurrenceLine);
  const focusedVariableOccurrenceIndex = Math.max(0, activeVariableOccurrenceIndex);
  const normalizedOutlineQuery = outlineQuery.trim().toLowerCase();
  const runtimePlacementFunction =
    inspection.functions.find((waypoint) => waypoint.id === runtimePlacementFunctionId) ?? null;
  const runtimePlacement = useMemo(
    () => runtimePlacementFunction ? runtimePlacementFor(file, runtimePlacementFunction, sourceFiles) : null,
    [file, runtimePlacementFunction, sourceFiles]
  );
  const outlineImports = useMemo(
    () => importRows
      .map((row) => ({
        id: `${row.line}:${row.name}`,
        name: row.name,
        line: row.line,
        iconLabel: row.detail ?? "import",
        detail: row.detail,
        tags: row.detail ? [row.detail] : undefined
      }))
      .filter((item) => sourceOutlineMatchesQuery(item, normalizedOutlineQuery)),
    [importRows, normalizedOutlineQuery]
  );
  const outlineFunctions = useMemo(
    () => inspection.functions
      .map((waypoint) => ({
        id: waypoint.id,
        name: waypoint.name,
        line: waypoint.startLine,
        iconLabel: waypoint.group,
        detail: `${waypoint.lineCount}L`,
        tags: [
          ...(waypoint.exported ? ["export"] : []),
          ...(waypoint.outputs.some((output) => output.async) ? ["async"] : [])
        ]
      }))
      .filter((item) => sourceOutlineMatchesQuery(item, normalizedOutlineQuery)),
    [inspection.functions, normalizedOutlineQuery]
  );
  const outlineVariables = useMemo(() => {
    const declarationSourceLine = (line: number): string => sourceLines[line - 1] ?? "";

    return [...inspection.operationalVariables, ...inspection.localVariables]
      .map((variable) => {
        const scopeTier = variableScopeTierFor(variable);
        const blastRadius = variableBlastRadiusFor(variable);
        const typeTag = variableTypeTagFor(variable, declarationSourceLine(variable.declarationLine));

        return {
          id: variable.id,
          name: variable.name,
          line: variable.declarationLine,
          scopeTier,
          typeTag,
          blastRadius,
          pipFillCount: blastRadius
        };
      })
      .filter((item) => sourceOutlineMatchesQuery({
        name: item.name,
        line: item.line,
        detail: item.scopeTier,
        tags: [item.typeTag.label, item.scopeTier]
      }, normalizedOutlineQuery))
      .sort((left, right) =>
        right.blastRadius - left.blastRadius ||
        right.line - left.line ||
        left.name.localeCompare(right.name)
      );
  }, [inspection.localVariables, inspection.operationalVariables, normalizedOutlineQuery, sourceLines]);
  const outlineVariableGroups = useMemo(() => {
    const groups: VariableOutlineGroup[] = [
      { id: "app-wide", label: "App-wide state", edgeClassName: "is-app-wide", items: [] },
      { id: "shared", label: "Shared / subtree", edgeClassName: "is-shared", items: [] },
      { id: "local", label: "Local only", edgeClassName: "is-local", items: [] }
    ];

    for (const item of outlineVariables) {
      const group = groups.find((candidate) => candidate.id === item.scopeTier);
      if (group) {
        group.items.push(item);
      }
    }

    return groups;
  }, [outlineVariables]);
  const localVariableGroup = useMemo(
    () => outlineVariableGroups.find((group) => group.id === "local") ?? { id: "local", label: "Local only", edgeClassName: "is-local", items: [] },
    [outlineVariableGroups]
  );
  const outlineSections = useMemo(() => {
    const sections = inspection.sections
      .map((section, index) => {
        const nextLine = inspection.sections[index + 1]?.line ?? (sourceLines.length + 1);
        const span = Math.max(1, nextLine - section.line);

        return {
          id: section.id,
          label: section.label,
          line: section.line,
          iconLabel: section.detail,
          detail: section.detail,
          span
        };
      })
      .filter((item) => sourceOutlineMatchesQuery(item, normalizedOutlineQuery));

    const longestSpan = sections.reduce((maximum, section) => Math.max(maximum, section.span), 1);

    return sections.map((section) => ({
      ...section,
      barWidth: Math.max(4, (section.span / longestSpan) * 48)
    }));
  }, [inspection.sections, normalizedOutlineQuery, sourceLines.length]);
  const outlineMeta = useMemo(
    () => ({
      lineCount: file.metadata?.linesOfCode ?? sourceLines.filter((line) => line.trim().length > 0).length,
      importCount: outlineImports.length,
      functionCount: outlineFunctions.length
    }),
    [file.metadata?.linesOfCode, outlineFunctions.length, outlineImports.length, sourceLines]
  );
  const isOutlineSearchActive = normalizedOutlineQuery.length > 0;
  const variableGroupExpansion = useMemo<Record<VariableScopeTier, boolean>>(() => ({
    "app-wide": isOutlineSearchActive || areAppWideVariablesExpanded,
    shared: isOutlineSearchActive || areSharedVariablesExpanded,
    local: isOutlineSearchActive || areLocalVariablesExpanded
  }), [areAppWideVariablesExpanded, areLocalVariablesExpanded, areSharedVariablesExpanded, isOutlineSearchActive]);
  const importsExpanded = areImportsExpanded || isOutlineSearchActive;
  const functionsExpanded = areFunctionWaypointsExpanded || isOutlineSearchActive;
  const variablesExpanded = areVariablesExpanded || isOutlineSearchActive;
  const sectionsExpanded = areSectionsExpanded || isOutlineSearchActive;
  const foldableFunctionByStartLine = useMemo(() => {
    const functionsByLine = new Map<number, SourceFunctionWaypoint>();

    for (const waypoint of inspection.functions) {
      if (waypoint.endLine <= waypoint.startLine) {
        continue;
      }

      const existing = functionsByLine.get(waypoint.startLine);
      if (!existing || waypoint.endLine > existing.endLine) {
        functionsByLine.set(waypoint.startLine, waypoint);
      }
    }

    return functionsByLine;
  }, [inspection.functions]);
  const traceLines = useMemo(() => {
    const callLines = new Set<number>();
    const stateUpdateLines = new Set<number>();
    const importedCallLines = new Set<number>();
    const localTargetLines = new Set<number>();

    if (activeFunction) {
      for (const call of activeFunction.calls) {
        callLines.add(call.line);

        if (call.definitionPath && call.definitionPath !== file.path) {
          importedCallLines.add(call.line);
        }

        if (call.definitionPath === file.path && call.definitionName) {
          const target = call.definitionWaypointId
            ? inspection.functions.find((waypoint) => waypoint.waypointId === call.definitionWaypointId)
            : inspection.functions.find((waypoint) => waypoint.name === call.definitionName);
          if (target) {
            for (let line = target.startLine; line <= target.endLine; line += 1) {
              localTargetLines.add(line);
            }
          }
        }
      }

      for (const update of activeFunction.stateUpdates) {
        stateUpdateLines.add(update.line);
      }
    }

    return { callLines, stateUpdateLines, importedCallLines, localTargetLines };
  }, [activeFunction, file.path, inspection.functions]);
  const variableTraceLines = useMemo(() => {
    const declarationLines = new Set<number>();
    const usageLines = new Set<number>();
    const mutationLines = new Set<number>();

    if (activeVariable) {
      declarationLines.add(activeVariable.declarationLine);
      activeVariable.mutationLines.forEach((line) => mutationLines.add(line));

      const priorityLines = [
        ...activeVariable.mutationLines,
        ...activeVariable.renderingLines,
        ...activeVariable.conditionLines,
        ...activeVariable.helperCallLines,
        ...activeVariable.usageLines
      ];

      for (const line of priorityLines) {
        if (usageLines.size >= 12) {
          break;
        }

        if (line !== activeVariable.declarationLine) {
          usageLines.add(line);
        }
      }

      if (activeVariableOccurrenceLine !== null && activeVariableOccurrenceLine !== activeVariable.declarationLine) {
        usageLines.add(activeVariableOccurrenceLine);
      }
    }

    return { declarationLines, usageLines, mutationLines };
  }, [activeVariable, activeVariableOccurrenceLine]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    setHighlightedSource(null);
    if (!sourceText || (isMarkdownFile && markdownDisplayMode === "rendered")) {
      return;
    }

    highlightSource(sourceText, file.metadata?.extension)
      .then((result) => {
        if (!cancelled) {
          setHighlightedSource(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedSource(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file.metadata?.extension, isMarkdownFile, markdownDisplayMode, sourceText]);

  useEffect(() => {
    setActiveFunctionId(null);
    setSelectedRange(null);
    setMarkdownDisplayMode("rendered");
    setAreImportsExpanded(true);
    setAreFunctionWaypointsExpanded(true);
    setAreVariablesExpanded(true);
    setAreSectionsExpanded(false);
    setExpandedCirculationRegion("inputs");
    setFoldedFunctionIds(new Set());
    setRuntimePlacementFunctionId(null);
    setActiveVariableId(null);
    setActiveVariableOccurrenceLine(null);
    lineRefs.current.clear();
  }, [file.id]);

  useEffect(() => {
    if (!isResizingRail) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    function handlePointerMove(event: PointerEvent): void {
      const origin = railResizeOriginRef.current;

      if (origin) {
        setRailWidth(clampSourceRailWidth(origin.width + event.clientX - origin.pointerX));
      }
    }

    function endRailResize(): void {
      railResizeOriginRef.current = null;
      setIsResizingRail(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endRailResize);
    window.addEventListener("pointercancel", endRailResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endRailResize);
      window.removeEventListener("pointercancel", endRailResize);
    };
  }, [isResizingRail]);

  function beginRailResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    railResizeOriginRef.current = {
      pointerX: event.clientX,
      width: railWidth
    };
    setIsResizingRail(true);
  }

  function resizeRailWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const increment = event.shiftKey ? 40 : 12;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setRailWidth((width) => clampSourceRailWidth(width - increment));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setRailWidth((width) => clampSourceRailWidth(width + increment));
    } else if (event.key === "Home") {
      event.preventDefault();
      setRailWidth(SOURCE_RAIL_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setRailWidth(SOURCE_RAIL_MAX_WIDTH);
    }
  }

  function tokenStyle(token: HighlightedSource["tokens"][number][number]): CSSProperties {
    return {
      color: token.color,
      fontStyle: token.fontStyle && (token.fontStyle & 1) !== 0 ? "italic" : undefined,
      fontWeight: token.fontStyle && (token.fontStyle & 2) !== 0 ? 700 : undefined,
      textDecoration: token.fontStyle && (token.fontStyle & 4) !== 0 ? "underline" : undefined
    };
  }

  function navigateToRange(range: LineRange): void {
    const destination = lineRefs.current.get(range.startLine);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    destination?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center"
    });
  }

  function navigateToOutlineLine(line: number): void {
    const foldsToReveal = inspection.functions.filter(
      (candidate) =>
        foldedFunctionIds.has(candidate.id) &&
        candidate.startLine < line &&
        candidate.endLine >= line
    );

    setActiveFunctionId(null);
    setRuntimePlacementFunctionId(null);
    setActiveVariableId(null);
    setActiveVariableOccurrenceLine(null);
    setSelectedRange({ startLine: line, endLine: line });
    if (foldsToReveal.length > 0) {
      setFoldedFunctionIds((current) => {
        const next = new Set(current);
        foldsToReveal.forEach((candidate) => next.delete(candidate.id));
        return next;
      });
      window.requestAnimationFrame(() => navigateToRange({ startLine: line, endLine: line }));
    } else {
      navigateToRange({ startLine: line, endLine: line });
    }
  }

  function navigateToFunction(waypoint: SourceFunctionWaypoint): void {
    const range = { startLine: waypoint.startLine, endLine: waypoint.endLine };
    const foldsToReveal = inspection.functions.filter(
      (candidate) =>
        foldedFunctionIds.has(candidate.id) &&
        candidate.startLine <= waypoint.startLine &&
        candidate.endLine >= waypoint.startLine
    );

    setAreFunctionWaypointsExpanded(true);
    setRuntimePlacementFunctionId(null);
    setActiveVariableId(null);
    setActiveVariableOccurrenceLine(null);
    if (waypoint.id !== activeFunctionId) {
      setExpandedCirculationRegion("inputs");
    }
    setActiveFunctionId(waypoint.id);
    setSelectedRange(range);
    if (foldsToReveal.length > 0) {
      setFoldedFunctionIds((current) => {
        const next = new Set(current);
        foldsToReveal.forEach((candidate) => next.delete(candidate.id));
        return next;
      });
      window.requestAnimationFrame(() => navigateToRange(range));
    } else {
      navigateToRange(range);
    }
  }

  function navigateToSection(section: SourceSectionAnchor): void {
    navigateToOutlineLine(section.line);
  }

  function clearWaypointSelection(): void {
    setActiveFunctionId(null);
    setSelectedRange(null);
    setExpandedCirculationRegion("inputs");
  }

  function focusVariableOccurrence(variable: SourceVariableWaypoint, line: number): void {
    const foldsToReveal = inspection.functions.filter(
      (candidate) =>
        foldedFunctionIds.has(candidate.id) &&
        candidate.startLine < line &&
        candidate.endLine >= line
    );

    setActiveFunctionId(null);
    setSelectedRange(null);
    setRuntimePlacementFunctionId(null);
    setActiveVariableId(variable.id);
    setActiveVariableOccurrenceLine(line);
    if (foldsToReveal.length > 0) {
      setFoldedFunctionIds((current) => {
        const next = new Set(current);
        foldsToReveal.forEach((candidate) => next.delete(candidate.id));
        return next;
      });
    }

    window.requestAnimationFrame(() => navigateToRange({ startLine: line, endLine: line }));
  }

  function focusVariable(variable: SourceVariableWaypoint): void {
    const firstOccurrence = variableOccurrenceLines(variable)[0] ?? variable.declarationLine;

    focusVariableOccurrence(variable, firstOccurrence);
  }

  function navigateVariableOccurrence(direction: -1 | 1): void {
    if (!activeVariable || activeVariableOccurrences.length === 0) {
      return;
    }

    const nextIndex = focusedVariableOccurrenceIndex + direction;
    const nextLine = activeVariableOccurrences[nextIndex];

    if (typeof nextLine === "number") {
      focusVariableOccurrence(activeVariable, nextLine);
    }
  }

  function variableSignal(variable: SourceVariableWaypoint): string {
    const suffix = variable.runtimeRelated
      ? "runtime-aware"
      : variable.mutationLines.length > 0
        ? `${variable.mutationLines.length} update${variable.mutationLines.length === 1 ? "" : "s"}`
        : variable.renderingLines.length > 0
          ? "render-linked"
          : variable.conditionLines.length > 0
            ? "condition-linked"
            : "local evidence";

    return `${variable.usageLines.length} refs / ${suffix}`;
  }

  function toggleFunctionFold(waypoint: SourceFunctionWaypoint): void {
    setFoldedFunctionIds((current) => {
      const next = new Set(current);

      if (next.has(waypoint.id)) {
        next.delete(waypoint.id);
      } else {
        next.add(waypoint.id);
      }

      return next;
    });
  }

  function enterRuntimePlacement(waypoint: SourceFunctionWaypoint): void {
    setActiveFunctionId(null);
    setSelectedRange(null);
    setActiveVariableId(null);
    setActiveVariableOccurrenceLine(null);
    setRuntimePlacementFunctionId(waypoint.id);
  }

  function exitRuntimePlacement(): void {
    const focusedFunction = runtimePlacementFunction;
    setRuntimePlacementFunctionId(null);

    if (focusedFunction) {
      window.requestAnimationFrame(() => navigateToRange({
        startLine: focusedFunction.startLine,
        endLine: focusedFunction.endLine
      }));
    }
  }

  function functionStyle(waypoint: SourceFunctionWaypoint): SourceStyle {
    return {
      "--function-gravity": Math.min(1, 0.16 + waypoint.gravityScore / 115).toFixed(2)
    };
  }

  function renderVariableAwareText(content: string, lineNumber: number, keyPrefix: string): ReactNode {
    if (!activeVariable || !activeVariableOccurrences.includes(lineNumber) || !content.includes(activeVariable.name)) {
      return content;
    }

    const matcher = new RegExp(`(^|[^A-Za-z0-9_$])(${escapedPattern(activeVariable.name)})(?![A-Za-z0-9_$])`, "g");
    const parts: ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null = matcher.exec(content);

    while (match) {
      const occurrenceStart = match.index + match[1].length;
      const occurrenceEnd = occurrenceStart + activeVariable.name.length;

      if (occurrenceStart > cursor) {
        parts.push(content.slice(cursor, occurrenceStart));
      }

      parts.push(
        <span className="source-modal__variable-token" key={`${keyPrefix}-${occurrenceStart}`}>
          {content.slice(occurrenceStart, occurrenceEnd)}
        </span>
      );
      cursor = occurrenceEnd;
      match = matcher.exec(content);
    }

    if (parts.length === 0) {
      return content;
    }

    if (cursor < content.length) {
      parts.push(content.slice(cursor));
    }

    return parts;
  }

  function renderCodeLine(line: string, lineIndex: number) {
    const lineNumber = lineIndex + 1;
    const hiddenByFold = inspection.functions.some(
      (waypoint) =>
        foldedFunctionIds.has(waypoint.id) &&
        lineNumber > waypoint.startLine &&
        lineNumber <= waypoint.endLine
    );

    if (hiddenByFold) {
      return null;
    }

    const foldableFunction = foldableFunctionByStartLine.get(lineNumber);
    const isFolded = Boolean(foldableFunction && foldedFunctionIds.has(foldableFunction.id));
    const tokens = highlightedSource?.tokens[lineIndex];
    const isFocused = Boolean(selectedRange && lineNumber >= selectedRange.startLine && lineNumber <= selectedRange.endLine);
    const isSelectedStart = inspection.functions.some(
      (waypoint) => waypoint.id === activeFunctionId && waypoint.startLine === lineNumber
    );
    const classNames = [
      "source-modal__line",
      foldableFunction ? "is-foldable" : "",
      isFolded ? "is-folded" : "",
      isFocused ? "is-focused" : "",
      isSelectedStart ? "is-selected-start" : "",
      traceLines.callLines.has(lineNumber) ? "is-call-site" : "",
      traceLines.stateUpdateLines.has(lineNumber) ? "is-state-update" : "",
      traceLines.importedCallLines.has(lineNumber) ? "is-imported-call" : "",
      traceLines.localTargetLines.has(lineNumber) ? "is-local-target" : "",
      variableTraceLines.declarationLines.has(lineNumber) ? "is-variable-declaration" : "",
      variableTraceLines.usageLines.has(lineNumber) ? "is-variable-use" : "",
      variableTraceLines.mutationLines.has(lineNumber) ? "is-variable-mutation" : "",
      lineNumber === activeVariableOccurrenceLine ? "is-variable-occurrence-focus" : ""
    ].filter(Boolean).join(" ");

    return (
      <span
        className={classNames}
        key={lineNumber}
        ref={(element) => {
          if (element) {
            lineRefs.current.set(lineNumber, element);
          } else {
            lineRefs.current.delete(lineNumber);
          }
        }}
      >
        <span className="source-modal__line-gutter">
          {foldableFunction ? (
            <button
              type="button"
              className="source-modal__fold-toggle"
              aria-label={`${isFolded ? "Expand" : "Collapse"} ${foldableFunction.name}`}
              aria-expanded={!isFolded}
              title={`${isFolded ? "Expand" : "Collapse"} ${foldableFunction.name}()`}
              onClick={() => toggleFunctionFold(foldableFunction)}
            >
              <span aria-hidden="true" />
            </button>
          ) : <span className="source-modal__fold-spacer" aria-hidden="true" />}
          <span className="source-modal__line-number" aria-hidden="true">{lineNumber}</span>
        </span>
        {isFolded && foldableFunction ? (
          <button
            type="button"
            className="source-modal__line-code source-modal__folded-function-focus"
            aria-label={`Place ${foldableFunction.name} in runtime corridor`}
            onClick={() => enterRuntimePlacement(foldableFunction)}
          >
            {tokens
              ? tokens.map((token, tokenIndex) => (
                  <span key={tokenIndex} style={tokenStyle(token)}>
                    {renderVariableAwareText(token.content, lineNumber, `folded-${tokenIndex}`)}
                  </span>
                ))
              : renderVariableAwareText(line || " ", lineNumber, "folded-raw")}
            <span className="source-modal__fold-summary">
              {"  "}... {foldableFunction.endLine - foldableFunction.startLine} lines folded
            </span>
          </button>
        ) : (
          <span className="source-modal__line-code">
            {tokens
              ? tokens.map((token, tokenIndex) => (
                  <span key={tokenIndex} style={tokenStyle(token)}>
                    {renderVariableAwareText(token.content, lineNumber, `line-${tokenIndex}`)}
                  </span>
                ))
              : renderVariableAwareText(line || " ", lineNumber, "raw")}
          </span>
        )}
      </span>
    );
  }

  return (
    <div
      className="source-modal__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="source-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
        aria-describedby="source-modal-path"
        onMouseDownCapture={(event) => {
          const target = event.target;

          if (
            target instanceof Element &&
            !target.closest(".source-modal__function-card, .source-modal__fold-toggle")
          ) {
            clearWaypointSelection();
          }

          if (target instanceof Element && !target.closest(".source-modal__variable, .source-modal__variable-navigation")) {
            setActiveVariableId(null);
            setActiveVariableOccurrenceLine(null);
          }
        }}
      >
        <header className="source-modal__header">
          <div className="source-modal__identity">
            <h2 id="source-modal-title">{file.label}</h2>
            <div id="source-modal-path" className="source-modal__path" title={file.path}>{file.path}</div>
            <div className="source-modal__meta">
              <span>{languageLabel}</span>
              {typeof file.metadata?.linesOfCode === "number" ? <span>{file.metadata.linesOfCode} LOC</span> : null}
              {typeof file.metadata?.functionCount === "number" ? <span>{file.metadata.functionCount} Functions</span> : null}
              {isMarkdownFile && markdownDisplayMode === "rendered" ? (
                <span className="is-highlighted">Rendered Document</span>
              ) : null}
              {runtimeContext?.inActiveCorridor ? <span className="is-runtime">Runtime Corridor</span> : null}
            </div>
          </div>
          <button type="button" className="source-modal__close" aria-label="Close source inspection" onClick={onClose} autoFocus>
            <span />
            <span />
          </button>
        </header>
        <div
          className={`source-modal__surface ${isResizingRail ? "is-resizing" : ""}`}
          style={{ "--source-rail-width": `${railWidth}px` } as SourceStyle}
        >
          <aside id="source-modal-navigation" className="source-modal__navigation" aria-label="File outline">
            <div className="source-modal__outline-header">
              <div className="source-modal__outline-title-block">
                <div className="source-modal__outline-title-row">
                  <strong className="source-modal__outline-name">{fileStemLabel(file.label)}</strong>
                  {fileExtensionLabel(file.label) ? (
                    <span className="source-modal__outline-extension">{fileExtensionLabel(file.label)}</span>
                  ) : null}
                </div>
                <div className="source-modal__outline-meta">
                  <span>{outlineMeta.lineCount} lines</span>
                  <span>{outlineMeta.importCount} imports</span>
                  <span>{outlineMeta.functionCount} functions</span>
                </div>
              </div>
              <input
                className="source-modal__outline-search"
                value={outlineQuery}
                onChange={(event) => setOutlineQuery(event.target.value)}
                placeholder="Search outline"
                aria-label="Search file outline"
              />
            </div>

            <section className={`source-modal__outline-group ${importsExpanded ? "is-expanded" : "is-collapsed"}`}>
              <button
                type="button"
                className="source-modal__outline-group-toggle"
                aria-expanded={importsExpanded}
                onClick={() => setAreImportsExpanded((expanded) => !expanded)}
              >
                <span className="source-modal__outline-group-title">
                  <span className="source-modal__outline-group-icon source-modal__outline-group-icon--imports">&#8595;</span>
                  <span>Imports</span>
                </span>
                <small>{outlineImports.length}</small>
                <i aria-hidden="true" />
              </button>
              {importsExpanded ? (
                outlineImports.length > 0 ? (
                  <div className="source-modal__outline-rows">
                    {outlineImports.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`source-modal__outline-row ${selectedRange?.startLine === item.line ? "is-active" : ""}`.trim()}
                        onClick={() => navigateToOutlineLine(item.line)}
                      >
                        <span className="source-modal__outline-row-left">
                          <span className="source-modal__outline-row-icon source-modal__outline-row-icon--imports">&#8595;</span>
                          <span className="source-modal__outline-row-name">{item.name}</span>
                        </span>
                        <span className="source-modal__outline-row-right">
                          {item.tags?.length ? (
                            <span className="source-modal__outline-row-tags">
                              {item.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </span>
                          ) : null}
                          <span className="source-modal__outline-row-line">:{item.line}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="source-modal__outline-empty">No imports match the current search.</p>
                )
              ) : null}
            </section>

            <section className={`source-modal__outline-group ${functionsExpanded ? "is-expanded" : "is-collapsed"}`}>
              <button
                type="button"
                className="source-modal__outline-group-toggle"
                aria-expanded={functionsExpanded}
                onClick={() => setAreFunctionWaypointsExpanded((expanded) => !expanded)}
              >
                <span className="source-modal__outline-group-title">
                  <span className="source-modal__outline-group-icon source-modal__outline-group-icon--functions">&#402;</span>
                  <span>Functions</span>
                </span>
                <small>{outlineFunctions.length}</small>
                <i aria-hidden="true" />
              </button>
              {functionsExpanded ? (
                outlineFunctions.length > 0 ? (
                  <div className="source-modal__outline-rows">
                    {outlineFunctions.map((item) => {
                      const isActive = activeFunctionId === item.id;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`source-modal__outline-row ${isActive ? "is-active" : ""}`.trim()}
                          onClick={() => {
                            const waypoint = inspection.functions.find((candidate) => candidate.id === item.id);
                            if (waypoint) {
                              navigateToFunction(waypoint);
                            }
                          }}
                        >
                          <span className="source-modal__outline-row-left">
                            <span className="source-modal__outline-row-icon source-modal__outline-row-icon--functions">&#402;</span>
                            <span className="source-modal__outline-row-name">{item.name}</span>
                          </span>
                          <span className="source-modal__outline-row-right">
                            {item.tags?.length ? (
                              <span className="source-modal__outline-row-tags">
                                {item.tags.map((tag) => (
                                  <span key={tag}>{tag}</span>
                                ))}
                              </span>
                            ) : null}
                            <span className="source-modal__outline-row-line">:{item.line}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="source-modal__outline-empty">No functions match the current search.</p>
                )
              ) : null}
            </section>

            <section className={`source-modal__outline-group ${variablesExpanded ? "is-expanded" : "is-collapsed"}`}>
              <button
                type="button"
                className="source-modal__outline-group-toggle"
                aria-expanded={variablesExpanded}
                onClick={() => setAreVariablesExpanded((expanded) => !expanded)}
              >
                <span className="source-modal__outline-group-title">
                  <span className="source-modal__outline-group-icon source-modal__outline-group-icon--variables">&#8801;</span>
                  <span>Variables</span>
                </span>
                <small>{outlineVariables.length}</small>
                <i aria-hidden="true" />
              </button>
              {variablesExpanded ? (
                outlineVariables.length > 0 ? (
                  <div className="source-modal__outline-variable-legend" aria-label="Variable scope legend">
                    <span><i className="is-app-wide" />App-wide state</span>
                    <span><i className="is-shared" />Shared / subtree</span>
                    <span><i className="is-local" />Local only</span>
                  </div>
                ) : null
              ) : null}
              {variablesExpanded ? (
                outlineVariableGroups.some((group) => group.items.length > 0) ? (
                  <div className="source-modal__outline-variable-groups">
                    {outlineVariableGroups.map((group, groupIndex) => {
                      const isExpanded = variableGroupExpansion[group.id];
                      const isLocalGroup = group.id === "local";

                      return (
                        <div key={group.id} className="source-modal__outline-variable-group">
                          {groupIndex > 0 ? <div className="source-modal__outline-divider" /> : null}
                          <button
                            type="button"
                            className={`source-modal__outline-variable-group-toggle ${group.edgeClassName}`.trim()}
                            aria-expanded={isExpanded}
                            onClick={() => {
                              if (group.id === "app-wide") {
                                setAreAppWideVariablesExpanded((expanded) => !expanded);
                              } else if (group.id === "shared") {
                                setAreSharedVariablesExpanded((expanded) => !expanded);
                              } else {
                                setAreLocalVariablesExpanded((expanded) => !expanded);
                              }
                            }}
                          >
                            <span className="source-modal__outline-variable-group-title">
                              <span className={`source-modal__outline-variable-group-dot ${group.edgeClassName}`} aria-hidden="true" />
                              <span>{group.label}</span>
                              <small>{group.items.length}</small>
                            </span>
                            <i aria-hidden="true" />
                          </button>
                          {isExpanded && group.items.length > 0 ? (
                            <div className="source-modal__outline-rows source-modal__outline-rows--variables">
                              {group.items.map((item) => {
                                const variable = [...inspection.operationalVariables, ...inspection.localVariables].find((candidate) => candidate.id === item.id);
                                const isActive = activeVariableId === item.id || activeVariableOccurrenceLine === item.line;

                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={`source-modal__outline-variable-row ${isActive ? "is-active" : ""} ${variableEdgeClassName(item.scopeTier)}`.trim()}
                                    onClick={() => variable ? focusVariableOccurrence(variable, item.line) : undefined}
                                  >
                                    <span className={`source-modal__outline-variable-edge ${variableEdgeClassName(item.scopeTier)}`} aria-hidden="true" />
                                    <span className="source-modal__outline-variable-pips" aria-hidden="true">
                                      {Array.from({ length: 4 }, (_, index) => {
                                        const filled = index < item.pipFillCount;
                                        return <span key={`${item.id}-${index}`} className={`source-modal__outline-variable-pip ${filled ? variablePipColorClass(item.pipFillCount) : "is-dark"}`.trim()} />;
                                      })}
                                    </span>
                                    <span className="source-modal__outline-variable-main">
                                      <span className="source-modal__outline-variable-name">{item.name}</span>
                                      <span className={`source-modal__outline-variable-tag ${item.typeTag.className}`.trim()}>{item.typeTag.label}</span>
                                    </span>
                                    <span className="source-modal__outline-variable-line">:{item.line}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {isLocalGroup && !isExpanded && group.items.length > 0 && !isOutlineSearchActive ? (
                            <button
                              type="button"
                              className="source-modal__outline-variable-more"
                              onClick={() => setAreLocalVariablesExpanded(true)}
                            >
                              <span>{group.items.length} more local variables</span>
                              <i aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="source-modal__outline-empty">No variables match the current search.</p>
                )
              ) : null}
            </section>

            <section className={`source-modal__outline-group ${sectionsExpanded ? "is-expanded" : "is-collapsed"}`}>
              <button
                type="button"
                className="source-modal__outline-group-toggle"
                aria-expanded={sectionsExpanded}
                onClick={() => setAreSectionsExpanded((expanded) => !expanded)}
              >
                <span className="source-modal__outline-group-title">
                  <span className="source-modal__outline-group-icon source-modal__outline-group-icon--sections">&#167;</span>
                  <span>Sections</span>
                </span>
                <small>{outlineSections.length}</small>
                <i aria-hidden="true" />
              </button>
              {sectionsExpanded ? (
                outlineSections.length > 0 ? (
                  <div className="source-modal__outline-rows">
                    {outlineSections.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`source-modal__outline-row ${selectedRange?.startLine === item.line ? "is-active" : ""}`.trim()}
                        onClick={() => navigateToSection(item)}
                      >
                        <span className="source-modal__outline-row-left">
                          <span className="source-modal__outline-row-icon source-modal__outline-row-icon--sections">&#167;</span>
                          <span className="source-modal__outline-row-name">{item.label}</span>
                          <span className="source-modal__outline-row-bar" aria-hidden="true">
                            <span className="source-modal__outline-row-bar-fill" style={{ width: `${item.barWidth}px` }} />
                          </span>
                        </span>
                        <span className="source-modal__outline-row-right">
                          <span className="source-modal__outline-row-line">:{item.line}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="source-modal__outline-empty">No sections match the current search.</p>
                )
              ) : null}
            </section>
          </aside>
          <section
            className="source-modal__implementation"
            aria-label={runtimePlacementFunction ? "Runtime placement" : "Source implementation"}
          >
            <div className="source-modal__implementation-header">
              <div className="source-modal__pane-label">
                {runtimePlacementFunction
                  ? "Runtime Placement"
                  : isMarkdownFile && markdownDisplayMode === "rendered"
                    ? "Rendered Document"
                    : "Implementation Field"}
              </div>
              {runtimePlacementFunction ? (
                <button type="button" className="source-modal__placement-return" onClick={exitRuntimePlacement}>
                  Return to Implementation
                </button>
              ) : activeVariable && activeVariableOccurrences.length > 0 ? (
                <div className="source-modal__variable-navigation" role="group" aria-label={`Navigate ${activeVariable.name} occurrences`}>
                  <code>{activeVariable.name}</code>
                  <span>{focusedVariableOccurrenceIndex + 1} / {activeVariableOccurrences.length}</span>
                  <button
                    type="button"
                    disabled={focusedVariableOccurrenceIndex === 0}
                    onClick={() => navigateVariableOccurrence(-1)}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={focusedVariableOccurrenceIndex >= activeVariableOccurrences.length - 1}
                    onClick={() => navigateVariableOccurrence(1)}
                  >
                    Next
                  </button>
                </div>
              ) : isMarkdownFile ? (
                <div className="source-modal__view-switch" role="group" aria-label="Markdown display mode">
                  <button
                    type="button"
                    className={markdownDisplayMode === "rendered" ? "is-active" : ""}
                    aria-pressed={markdownDisplayMode === "rendered"}
                    onClick={() => setMarkdownDisplayMode("rendered")}
                  >
                    Rendered
                  </button>
                  <button
                    type="button"
                    className={markdownDisplayMode === "raw" ? "is-active" : ""}
                    aria-pressed={markdownDisplayMode === "raw"}
                    onClick={() => setMarkdownDisplayMode("raw")}
                  >
                    Raw
                  </button>
                </div>
              ) : null}
            </div>
            <div className="source-modal__code-frame">
              {runtimePlacementFunction && runtimePlacement ? (
                <div
                  className="source-modal__placement"
                  aria-label={`Runtime placement for ${runtimePlacementFunction.name}`}
                >
                  <section className="source-modal__placement-lane source-modal__placement-lane--incoming">
                    <div className="source-modal__placement-label">Incoming Resolved Flow</div>
                    {runtimePlacement.incoming.length > 0 ? (
                      <div className="source-modal__placement-relations">
                        {runtimePlacement.incoming.map((relation) => (
                          <article
                            className={`source-modal__placement-relation ${relation.isCrossFile ? "is-cross-file" : ""}`.trim()}
                            key={relation.id}
                          >
                            <strong>{relation.isModuleScope ? relation.name : `${relation.name}()`}</strong>
                            <small>
                              {relation.connectionKind === "jsx-render"
                                ? relation.isModuleScope ? "Mounts Focus" : "Renders Focus"
                                : relation.isModuleScope ? "Invokes Focus" : "Direct Call"}
                            </small>
                            {relation.isCrossFile || relation.isModuleScope ? (
                              <span
                                className="source-modal__placement-relation-path source-modal__placement-relation-path--incoming"
                                title={relation.path}
                              >
                                {relation.path}
                              </span>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : <div className="source-modal__placement-empty">No resolved incoming links</div>}
                    {runtimePlacement.incomingOverflow > 0 ? (
                      <small className="source-modal__placement-overflow">+{runtimePlacement.incomingOverflow} direct caller{runtimePlacement.incomingOverflow === 1 ? "" : "s"}</small>
                    ) : null}
                  </section>
                  <span className="source-modal__placement-flow" aria-hidden="true" />
                  <section className="source-modal__placement-focus">
                    <small>Focused Function</small>
                    <strong>{runtimePlacementFunction.name}()</strong>
                    <span className="source-modal__placement-focus-path">{file.path}</span>
                  </section>
                  <span className="source-modal__placement-flow" aria-hidden="true" />
                  <section className="source-modal__placement-lane source-modal__placement-lane--outgoing">
                    <div className="source-modal__placement-label">Outgoing Resolved Flow</div>
                    {runtimePlacement.outgoing.length > 0 ? (
                      <div className="source-modal__placement-relations">
                        {runtimePlacement.outgoing.map((relation) => (
                          <article
                            className={`source-modal__placement-relation ${relation.isCrossFile ? "is-cross-file" : ""}`.trim()}
                            key={relation.id}
                          >
                            <strong>
                              {relation.connectionKind === "jsx-render" ? `<${relation.name} />` : `${relation.name}()`}
                            </strong>
                            <small>{relation.connectionKind === "jsx-render" ? "Rendered Component" : "Direct Call"}</small>
                            {relation.isCrossFile ? <span title={relation.path}>{relation.path}</span> : null}
                          </article>
                        ))}
                      </div>
                    ) : <div className="source-modal__placement-empty">No resolved outgoing links</div>}
                    {runtimePlacement.outgoingOverflow > 0 ? (
                      <small className="source-modal__placement-overflow">+{runtimePlacement.outgoingOverflow} direct call{runtimePlacement.outgoingOverflow === 1 ? "" : "s"}</small>
                    ) : null}
                  </section>
                </div>
              ) : (
                <div className="source-modal__viewport">
                    {sourceText === null ? (
                      <p className="source-modal__empty">Source text is unavailable. Analyze the repository again.</p>
                    ) : sourceText.length === 0 ? (
                      <p className="source-modal__empty">Empty file.</p>
                    ) : isMarkdownFile && markdownDisplayMode === "rendered" ? (
                      <Suspense fallback={<p className="source-modal__empty">Rendering document...</p>}>
                        <RenderedMarkdown sourceText={sourceText} />
                      </Suspense>
                    ) : (
                      <pre style={{ color: highlightedSource?.foreground }}>
                        <code>{sourceLines.map(renderCodeLine)}</code>
                      </pre>
                    )}
                </div>
              )}
            </div>
          </section>
          <div
            className="source-modal__rail-resizer"
            role="separator"
            aria-label="Resize operational rail"
            aria-controls="source-modal-navigation source-modal-implementation"
            aria-orientation="vertical"
            aria-valuemin={SOURCE_RAIL_MIN_WIDTH}
            aria-valuemax={SOURCE_RAIL_MAX_WIDTH}
            aria-valuenow={railWidth}
            tabIndex={0}
            onPointerDown={beginRailResize}
            onKeyDown={resizeRailWithKeyboard}
          >
            <span aria-hidden="true" />
          </div>
        </div>
      </section>
    </div>
  );
}
