import {
  lazy,
  Suspense,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { AtlasNode } from "../api";
import {
  inspectSource,
  operationalIdentityFor,
  type FunctionGroupLabel,
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

interface ViewportMarker {
  top: number;
  height: number;
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

const SOURCE_RAIL_MIN_WIDTH = 235;
const SOURCE_RAIL_MAX_WIDTH = 460;
const SOURCE_RAIL_INITIAL_WIDTH = 300;
const RUNTIME_PLACEMENT_LIMIT = 2;

function clampSourceRailWidth(width: number): number {
  return Math.max(SOURCE_RAIL_MIN_WIDTH, Math.min(SOURCE_RAIL_MAX_WIDTH, width));
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
  const waypointForTarget = (filePath: string, definitionWaypointId?: string, definitionName?: string) => {
    const waypoints = indexedFiles.get(filePath)?.metadata?.functionWaypoints ?? [];
    if (definitionWaypointId) {
      return waypoints.find((waypoint) => waypoint.waypointId === definitionWaypointId) ?? null;
    }

    const matches = definitionName ? waypoints.filter((waypoint) => waypoint.name === definitionName) : [];
    return matches.length === 1 ? matches[0] : null;
  };
  const indexedFocusedFunction = waypointForTarget(file.path, focusedFunction.waypointId, focusedFunction.name);

  if (indexedFocusedFunction?.startLine === focusedFunction.startLine) {
    for (const sourceFile of indexedFiles.values()) {
      for (const caller of sourceFile.metadata?.functionWaypoints ?? []) {
        const incomingConnection = caller.calls.find(
          (call) =>
            call.definitionPath === file.path &&
            (focusedFunction.waypointId
              ? call.definitionWaypointId === focusedFunction.waypointId
              : !call.definitionWaypointId && call.definitionName === focusedFunction.name)
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
          (focusedFunction.waypointId
            ? call.definitionWaypointId === focusedFunction.waypointId
            : !call.definitionWaypointId && call.definitionName === focusedFunction.name)
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

    const targetFunction = waypointForTarget(call.definitionPath, call.definitionWaypointId, call.definitionName);
    if (!targetFunction) {
      continue;
    }

    const id = `${call.definitionPath}:${call.definitionWaypointId ?? call.definitionName}`;
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
    incoming: incoming.slice(0, RUNTIME_PLACEMENT_LIMIT),
    incomingOverflow: Math.max(0, incoming.length - RUNTIME_PLACEMENT_LIMIT),
    outgoing: outgoing.slice(0, RUNTIME_PLACEMENT_LIMIT),
    outgoingOverflow: Math.max(0, outgoing.length - RUNTIME_PLACEMENT_LIMIT)
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
  const [areFunctionWaypointsExpanded, setAreFunctionWaypointsExpanded] = useState(true);
  const [areOperationalVariablesExpanded, setAreOperationalVariablesExpanded] = useState(true);
  const [areLocalVariablesExpanded, setAreLocalVariablesExpanded] = useState(false);
  const [areStructuralAnchorsExpanded, setAreStructuralAnchorsExpanded] = useState(false);
  const [expandedFunctionGroups, setExpandedFunctionGroups] = useState<Set<FunctionGroupLabel>>(
    () => new Set(inspection.groups[0] ? [inspection.groups[0].label] : [])
  );
  const [expandedCirculationRegion, setExpandedCirculationRegion] = useState<CirculationRegion | null>("inputs");
  const [foldedFunctionIds, setFoldedFunctionIds] = useState<Set<string>>(() => new Set());
  const [runtimePlacementFunctionId, setRuntimePlacementFunctionId] = useState<string | null>(null);
  const [activeVariableId, setActiveVariableId] = useState<string | null>(null);
  const [railWidth, setRailWidth] = useState(SOURCE_RAIL_INITIAL_WIDTH);
  const [isResizingRail, setIsResizingRail] = useState(false);
  const [viewportMarker, setViewportMarker] = useState<ViewportMarker>({ top: 0, height: 1 });
  const codeViewportRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef(new Map<number, HTMLSpanElement>());
  const railResizeOriginRef = useRef<{ pointerX: number; width: number } | null>(null);
  const languageLabel = sourceLanguageLabel(file.metadata?.extension);
  const totalFunctionCount = file.metadata?.functionCount ?? inspection.functions.length;
  const navigableFunctionCount = inspection.functions.length;
  const totalLines = Math.max(sourceLines.length, 1);
  const activeFunction = inspection.functions.find((waypoint) => waypoint.id === activeFunctionId) ?? null;
  const activeVariable = [...inspection.operationalVariables, ...inspection.localVariables]
    .find((variable) => variable.id === activeVariableId) ?? null;
  const runtimePlacementFunction =
    inspection.functions.find((waypoint) => waypoint.id === runtimePlacementFunctionId) ?? null;
  const runtimePlacement = useMemo(
    () => runtimePlacementFunction ? runtimePlacementFor(file, runtimePlacementFunction, sourceFiles) : null,
    [file, runtimePlacementFunction, sourceFiles]
  );
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
  const operationalIdentity = useMemo(
    () => operationalIdentityFor(file, inspection, {
      importCount: fileContext?.importCount ?? Number(file.metadata?.importCount ?? 0),
      importedByCount: fileContext?.importedByCount ?? 0,
      weight: fileContext?.weight
    }),
    [file, fileContext, inspection]
  );
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
    }

    return { declarationLines, usageLines, mutationLines };
  }, [activeVariable]);

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
    setAreFunctionWaypointsExpanded(true);
    setAreOperationalVariablesExpanded(true);
    setAreLocalVariablesExpanded(false);
    setAreStructuralAnchorsExpanded(false);
    setExpandedFunctionGroups(new Set(inspection.groups[0] ? [inspection.groups[0].label] : []));
    setExpandedCirculationRegion("inputs");
    setFoldedFunctionIds(new Set());
    setRuntimePlacementFunctionId(null);
    setActiveVariableId(null);
    lineRefs.current.clear();
  }, [file.id, inspection.groups]);

  const updateViewportMarker = useCallback(() => {
    const viewport = codeViewportRef.current;

    if (!viewport || viewport.scrollHeight <= 0) {
      setViewportMarker({ top: 0, height: 1 });
      return;
    }

    const height = Math.min(1, viewport.clientHeight / viewport.scrollHeight);
    const maximumTop = Math.max(0, 1 - height);
    const top = Math.min(maximumTop, viewport.scrollTop / viewport.scrollHeight);
    setViewportMarker({ top, height });
  }, []);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(updateViewportMarker);
    window.addEventListener("resize", updateViewportMarker);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateViewportMarker);
    };
  }, [foldedFunctionIds, highlightedSource, markdownDisplayMode, sourceLines.length, updateViewportMarker]);

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
    setExpandedFunctionGroups((current) => new Set(current).add(waypoint.group));
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
    const foldsToReveal = inspection.functions.filter(
      (candidate) =>
        foldedFunctionIds.has(candidate.id) &&
        candidate.startLine < section.line &&
        candidate.endLine >= section.line
    );

    setActiveFunctionId(null);
    setSelectedRange(null);
    setRuntimePlacementFunctionId(null);
    setActiveVariableId(null);
    if (foldsToReveal.length > 0) {
      setFoldedFunctionIds((current) => {
        const next = new Set(current);
        foldsToReveal.forEach((candidate) => next.delete(candidate.id));
        return next;
      });
      window.requestAnimationFrame(() => navigateToRange({ startLine: section.line, endLine: section.line }));
    } else {
      navigateToRange({ startLine: section.line, endLine: section.line });
    }
  }

  function clearWaypointSelection(): void {
    setActiveFunctionId(null);
    setSelectedRange(null);
    setExpandedCirculationRegion("inputs");
  }

  function toggleFunctionGroup(group: FunctionGroupLabel): void {
    setExpandedFunctionGroups((current) => {
      const next = new Set(current);

      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }

      return next;
    });
  }

  function focusVariable(variable: SourceVariableWaypoint): void {
    setActiveFunctionId(null);
    setSelectedRange(null);
    setRuntimePlacementFunctionId(null);
    setActiveVariableId((current) => current === variable.id ? null : variable.id);
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

  function minimapStyle(waypoint: SourceFunctionWaypoint): SourceStyle {
    return {
      top: `${((waypoint.startLine - 1) / totalLines) * 100}%`,
      height: `${Math.max(1.5, (waypoint.lineCount / totalLines) * 100)}%`,
      "--pressure-density": waypoint.pressure.density.toFixed(2),
      "--pressure-rendering": waypoint.pressure.rendering.toFixed(2),
      "--pressure-runtime": waypoint.pressure.runtime.toFixed(2),
      "--pressure-state": waypoint.pressure.state.toFixed(2),
      "--pressure-dependency": waypoint.pressure.dependency.toFixed(2)
    };
  }

  function functionStyle(waypoint: SourceFunctionWaypoint): SourceStyle {
    return {
      "--function-gravity": Math.min(1, 0.16 + waypoint.gravityScore / 115).toFixed(2)
    };
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
      variableTraceLines.mutationLines.has(lineNumber) ? "is-variable-mutation" : ""
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
                  <span key={tokenIndex} style={tokenStyle(token)}>{token.content}</span>
                ))
              : line || " "}
            <span className="source-modal__fold-summary">
              {"  "}... {foldableFunction.endLine - foldableFunction.startLine} lines folded
            </span>
          </button>
        ) : (
          <span className="source-modal__line-code">
            {tokens
              ? tokens.map((token, tokenIndex) => (
                  <span key={tokenIndex} style={tokenStyle(token)}>{token.content}</span>
                ))
              : line || " "}
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
            !target.closest(".source-modal__function-card, .source-modal__minimap-waypoint, .source-modal__fold-toggle")
          ) {
            clearWaypointSelection();
          }

          if (target instanceof Element && !target.closest(".source-modal__variable")) {
            setActiveVariableId(null);
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
          <section
            id="source-modal-operational-identity"
            className={`source-modal__operational-identity source-modal__operational-identity--${operationalIdentity.kind}`}
            aria-label="Operational identity"
          >
            <div className="source-modal__pane-label">Operational Identity</div>
            <div className="source-modal__primary-role">
              <small>Primary Role</small>
              <strong>{operationalIdentity.primaryRole}</strong>
            </div>
            <div className="source-modal__secondary-traits">
              <small>Secondary Traits</small>
              <div>
                {operationalIdentity.secondaryTraits.length > 0
                  ? operationalIdentity.secondaryTraits.map((trait) => (
                      <span className={`source-modal__trait source-modal__trait--${trait.kind}`} key={`${trait.kind}-${trait.label}`}>
                        {trait.label}
                      </span>
                    ))
                  : <span className="source-modal__trait-empty">No strong secondary signal</span>}
              </div>
            </div>
          </section>
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
                            {relation.isCrossFile || relation.isModuleScope ? <span title={relation.path}>{relation.path}</span> : null}
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
                    <span>{file.path}</span>
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
                <>
                  <div className="source-modal__viewport" ref={codeViewportRef} onScroll={updateViewportMarker}>
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
                  {inspection.functions.length > 0 ? (
                    <nav className="source-modal__minimap" aria-label="Source waypoint minimap">
                      <span
                        className="source-modal__minimap-viewport"
                        style={{
                          top: `${viewportMarker.top * 100}%`,
                          height: `${viewportMarker.height * 100}%`
                        }}
                      />
                      {inspection.functions.map((waypoint) => (
                        <button
                          type="button"
                          key={waypoint.id}
                          className={`source-modal__minimap-waypoint ${waypoint.id === activeFunctionId ? "is-active" : ""}`.trim()}
                          style={minimapStyle(waypoint)}
                          aria-label={`Navigate to ${waypoint.name}`}
                          onClick={() => navigateToFunction(waypoint)}
                        >
                          <span className="source-modal__pressure-density" />
                          <span className="source-modal__pressure-channel source-modal__pressure-channel--rendering" />
                          <span className="source-modal__pressure-channel source-modal__pressure-channel--runtime" />
                          <span className="source-modal__pressure-channel source-modal__pressure-channel--state" />
                          <span className="source-modal__pressure-channel source-modal__pressure-channel--dependency" />
                        </button>
                      ))}
                    </nav>
                  ) : null}
                </>
              )}
            </div>
          </section>
          <div
            className="source-modal__rail-resizer"
            role="separator"
            aria-label="Resize operational rail"
            aria-controls="source-modal-operational-identity source-modal-navigation"
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
          <aside id="source-modal-navigation" className="source-modal__navigation" aria-label="Operational navigation">
            <div className="source-modal__navigation-header">
              <div className="source-modal__pane-label">Navigation Rail</div>
              <strong>{navigableFunctionCount} waypoint{navigableFunctionCount === 1 ? "" : "s"}</strong>
              {totalFunctionCount > navigableFunctionCount ? (
                <span>{totalFunctionCount - navigableFunctionCount} inline or unnamed entr{totalFunctionCount - navigableFunctionCount === 1 ? "y" : "ies"} suppressed</span>
              ) : null}
            </div>
            {runtimeContext?.inActiveCorridor || runtimeContext?.exploredAsOrigin ? (
              <section className="source-modal__runtime-context" aria-label="Runtime relation">
                <div>Runtime Relation</div>
                {runtimeContext.isCurrentNode ? <strong>Active corridor node</strong> : null}
                {runtimeContext.inActiveCorridor && !runtimeContext.isCurrentNode ? <strong>Corridor participant</strong> : null}
                {typeof runtimeContext.runtimeStep === "number" ? <span>Waypoint {runtimeContext.runtimeStep + 1}</span> : null}
                {runtimeContext.exploredAsOrigin ? <span>Used as an X-Ray origin in this session</span> : null}
              </section>
            ) : null}
            <section
              className={`source-modal__nav-region source-modal__function-regions source-modal__disclosure-region ${areFunctionWaypointsExpanded ? "is-expanded" : "is-collapsed"}`}
              aria-label="Function navigation"
            >
              <button
                type="button"
                className="source-modal__region-toggle"
                aria-expanded={areFunctionWaypointsExpanded}
                onClick={() => setAreFunctionWaypointsExpanded((expanded) => !expanded)}
              >
                <span>Function Waypoints</span>
                <small>{navigableFunctionCount} waypoint{navigableFunctionCount === 1 ? "" : "s"}</small>
                <i aria-hidden="true" />
              </button>
              {areFunctionWaypointsExpanded ? (
                inspection.groups.length === 0 ? (
                  <p className="source-modal__nav-empty">
                    {typeof file.metadata?.functionCount === "number" && file.metadata.functionCount > 0
                      ? "No named waypoints extracted. Re-analyze after updating the backend if this graph predates inspection data."
                      : "No navigable source functions detected."}
                  </p>
                ) : inspection.groups.map((group) => {
                  const isGroupExpanded = expandedFunctionGroups.has(group.label);

                  return (
                    <div
                      className={`source-modal__function-group ${isGroupExpanded ? "is-expanded" : "is-collapsed"}`}
                      key={group.label}
                    >
                      <button
                        type="button"
                        className="source-modal__group-toggle"
                        aria-expanded={isGroupExpanded}
                        onClick={() => toggleFunctionGroup(group.label)}
                      >
                        <span>{group.label}</span>
                        <small>{group.functions.length}</small>
                        <i aria-hidden="true" />
                      </button>
                      {isGroupExpanded ? group.functions.map((waypoint) => {
                        const isActive = waypoint.id === activeFunctionId;

                        return (
                          <div
                            className={`source-modal__function-card source-modal__function-card--${waypoint.gravityLevel} ${isActive ? "is-expanded" : ""}`}
                            key={waypoint.id}
                            style={functionStyle(waypoint)}
                          >
                            <button
                              type="button"
                              className={`source-modal__function ${isActive ? "is-active" : ""}`.trim()}
                              onClick={() => navigateToFunction(waypoint)}
                            >
                              <span className="source-modal__function-name">{waypoint.name}()</span>
                              <span className="source-modal__function-meta">
                                {waypoint.lineCount}L / {waypoint.calls.length} links / {waypoint.stateUpdates.length} updates
                                {waypoint.exported ? " / export" : waypoint.public ? " / public" : ""}
                              </span>
                            </button>
                            {isActive ? (
                              <div className="source-modal__circulation" aria-label={`Data circulation for ${waypoint.name}`}>
                                <CirculationSection
                                  title="Inputs"
                                  summary={`${waypoint.inputs.length}`}
                                  isExpanded={expandedCirculationRegion === "inputs"}
                                  onToggle={() => setExpandedCirculationRegion((current) => current === "inputs" ? null : "inputs")}
                                >
                                  {waypoint.inputs.length > 0 ? waypoint.inputs.map((input) => (
                                    <div className="source-modal__flow-row" key={`${input.name}-${input.line}`}>
                                      <code>{input.name}</code>
                                      {input.type ? <span>{input.type}</span> : null}
                                      <small>line {input.line}</small>
                                      {input.sources?.map((source) => (
                                        <div className="source-modal__flow-link" key={`${source.filePath}-${source.line}-${source.expression}`}>
                                          <b>from</b>
                                          <span>{source.filePath} : {source.line}</span>
                                          <code>{source.functionName}() / {source.expression}</code>
                                        </div>
                                      ))}
                                    </div>
                                  )) : <div className="source-modal__flow-empty">None detected</div>}
                                </CirculationSection>
                                <CirculationSection
                                  title="Outputs"
                                  summary={`${waypoint.outputs.length}`}
                                  isExpanded={expandedCirculationRegion === "outputs"}
                                  onToggle={() => setExpandedCirculationRegion((current) => current === "outputs" ? null : "outputs")}
                                >
                                  {waypoint.outputs.length > 0 ? waypoint.outputs.map((output) => (
                                    <div className="source-modal__flow-row" key={`${output.line}-${output.expression}`}>
                                      <code>{output.expression}</code>
                                      {output.type ? <span>{output.type}</span> : null}
                                      <small>line {output.line}{output.async ? " / async" : ""}</small>
                                    </div>
                                  )) : <div className="source-modal__flow-empty">None detected</div>}
                                </CirculationSection>
                                <CirculationSection
                                  title="State Updates"
                                  summary={`${waypoint.stateUpdates.length}`}
                                  isExpanded={expandedCirculationRegion === "state-updates"}
                                  onToggle={() => setExpandedCirculationRegion((current) => current === "state-updates" ? null : "state-updates")}
                                >
                                  {waypoint.stateUpdates.length > 0 ? waypoint.stateUpdates.map((update) => (
                                    <div className="source-modal__flow-row" key={`${update.setter}-${update.line}`}>
                                      <code>{update.setter}({update.arguments.join(", ")})</code>
                                      <span>{update.state}</span>
                                      <small>line {update.line}</small>
                                    </div>
                                  )) : <div className="source-modal__flow-empty">None detected</div>}
                                </CirculationSection>
                                <CirculationSection
                                  title="Function Links"
                                  summary={`${waypoint.calls.length}`}
                                  isExpanded={expandedCirculationRegion === "calls"}
                                  onToggle={() => setExpandedCirculationRegion((current) => current === "calls" ? null : "calls")}
                                >
                                  {waypoint.calls.length > 0 ? waypoint.calls.map((call) => (
                                    <div className="source-modal__flow-row" key={`${call.connectionKind ?? "call"}-${call.name}-${call.line}`}>
                                      <code>
                                        {call.connectionKind === "jsx-render" ? `<${call.name} />` : `${call.name}()`}
                                      </code>
                                      {call.connectionKind === "jsx-render" ? <span>rendered component</span> : null}
                                      <small>line {call.line}</small>
                                      {call.definitionPath ? (
                                        <div className="source-modal__flow-link">
                                          <b>from</b>
                                          <span>{call.definitionPath}</span>
                                        </div>
                                      ) : null}
                                    </div>
                                  )) : <div className="source-modal__flow-empty">None detected</div>}
                                </CirculationSection>
                              </div>
                            ) : null}
                          </div>
                        );
                      }) : null}
                    </div>
                  );
                })
              ) : null}
            </section>
            <section
              className={`source-modal__nav-region source-modal__variable-region source-modal__disclosure-region ${areOperationalVariablesExpanded ? "is-expanded" : "is-collapsed"}`}
              aria-label="Operational variables"
            >
              <button
                type="button"
                className="source-modal__region-toggle"
                aria-expanded={areOperationalVariablesExpanded}
                onClick={() => setAreOperationalVariablesExpanded((expanded) => !expanded)}
              >
                <span>Operational Variables</span>
                <small>{inspection.operationalVariables.length} signal{inspection.operationalVariables.length === 1 ? "" : "s"}</small>
                <i aria-hidden="true" />
              </button>
              {areOperationalVariablesExpanded ? (
                inspection.operationalVariables.length > 0 ? (
                  <div className="source-modal__variable-list">
                    {inspection.operationalVariables.map((variable) => (
                      <button
                        type="button"
                        className={`source-modal__variable is-operational ${activeVariableId === variable.id ? "is-active" : ""}`.trim()}
                        key={variable.id}
                        onClick={() => focusVariable(variable)}
                      >
                        <span className="source-modal__variable-name">{variable.name}</span>
                        <span className="source-modal__variable-class">{variable.classification}</span>
                        <small>{variableSignal(variable)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="source-modal__nav-empty">No operational variable signals detected.</p>
                )
              ) : null}
            </section>
            <section
              className={`source-modal__nav-region source-modal__variable-region source-modal__local-variables source-modal__disclosure-region ${areLocalVariablesExpanded ? "is-expanded" : "is-collapsed"}`}
              aria-label="Local variables"
            >
              <button
                type="button"
                className="source-modal__region-toggle"
                aria-expanded={areLocalVariablesExpanded}
                onClick={() => setAreLocalVariablesExpanded((expanded) => !expanded)}
              >
                <span>Local Variables</span>
                <small>{inspection.localVariables.length} local variables suppressed</small>
                <i aria-hidden="true" />
              </button>
              {areLocalVariablesExpanded ? (
                inspection.localVariables.length > 0 ? (
                  <div className="source-modal__variable-list is-local">
                    {inspection.localVariables.map((variable) => (
                      <button
                        type="button"
                        className={`source-modal__variable is-local ${activeVariableId === variable.id ? "is-active" : ""}`.trim()}
                        key={variable.id}
                        onClick={() => focusVariable(variable)}
                      >
                        <span className="source-modal__variable-name">{variable.name}</span>
                        <span className="source-modal__variable-class">{variable.classification}</span>
                        <small>{variableSignal(variable)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="source-modal__nav-empty">No local implementation variables detected.</p>
                )
              ) : null}
            </section>
            {inspection.sections.length > 0 ? (
              <section
                className={`source-modal__nav-region source-modal__anchor-region source-modal__disclosure-region ${areStructuralAnchorsExpanded ? "is-expanded" : "is-collapsed"}`}
                aria-label="Structural sections"
              >
                <button
                  type="button"
                  className="source-modal__region-toggle"
                  aria-expanded={areStructuralAnchorsExpanded}
                  onClick={() => setAreStructuralAnchorsExpanded((expanded) => !expanded)}
                >
                  <span>Structural Anchors</span>
                  <small>{inspection.sections.length} section{inspection.sections.length === 1 ? "" : "s"}</small>
                  <i aria-hidden="true" />
                </button>
                {areStructuralAnchorsExpanded ? (
                  <div className="source-modal__anchor-list">
                    {inspection.sections.map((section) => (
                      <button type="button" key={section.id} onClick={() => navigateToSection(section)}>
                        <span>{section.label}</span>
                        <small>{section.detail}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>
      </section>
    </div>
  );
}
