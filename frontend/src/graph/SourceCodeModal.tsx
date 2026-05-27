import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AtlasNode } from "../api";
import {
  inspectSource,
  type FunctionGroupLabel,
  type SourceFunctionWaypoint,
  type SourceSectionAnchor
} from "./sourceInspection";
import { highlightSource, sourceLanguageLabel, type HighlightedSource } from "./sourceSyntaxHighlighting";

export interface SourceRuntimeContext {
  inActiveCorridor: boolean;
  isCurrentNode: boolean;
  exploredAsOrigin: boolean;
  runtimeStep?: number;
}

interface SourceCodeModalProps {
  file: AtlasNode;
  runtimeContext?: SourceRuntimeContext;
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

export function SourceCodeModal({ file, runtimeContext, onClose }: SourceCodeModalProps) {
  const sourceText = typeof file.sourceText === "string" ? file.sourceText : null;
  const sourceLines = useMemo(() => (sourceText === null ? [] : sourceText.split(/\r?\n/)), [sourceText]);
  const inspection = useMemo(() => inspectSource(file), [file]);
  const [highlightedSource, setHighlightedSource] = useState<HighlightedSource | null>(null);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const [activeFunctionId, setActiveFunctionId] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<LineRange | null>(null);
  const [areFunctionWaypointsExpanded, setAreFunctionWaypointsExpanded] = useState(true);
  const [areStructuralAnchorsExpanded, setAreStructuralAnchorsExpanded] = useState(false);
  const [expandedFunctionGroups, setExpandedFunctionGroups] = useState<Set<FunctionGroupLabel>>(
    () => new Set(inspection.groups[0] ? [inspection.groups[0].label] : [])
  );
  const [viewportMarker, setViewportMarker] = useState<ViewportMarker>({ top: 0, height: 1 });
  const codeViewportRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef(new Map<number, HTMLSpanElement>());
  const languageLabel = sourceLanguageLabel(file.metadata?.extension);
  const totalFunctionCount = file.metadata?.functionCount ?? inspection.functions.length;
  const navigableFunctionCount = inspection.functions.length;
  const totalLines = Math.max(sourceLines.length, 1);

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
    if (!sourceText) {
      setIsHighlighting(false);
      return;
    }

    setIsHighlighting(true);
    highlightSource(sourceText, file.metadata?.extension)
      .then((result) => {
        if (!cancelled) {
          setHighlightedSource(result);
          setIsHighlighting(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedSource(null);
          setIsHighlighting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file.metadata?.extension, sourceText]);

  useEffect(() => {
    setActiveFunctionId(null);
    setSelectedRange(null);
    setAreFunctionWaypointsExpanded(true);
    setAreStructuralAnchorsExpanded(false);
    setExpandedFunctionGroups(new Set(inspection.groups[0] ? [inspection.groups[0].label] : []));
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
  }, [highlightedSource, sourceLines.length, updateViewportMarker]);

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

    setAreFunctionWaypointsExpanded(true);
    setExpandedFunctionGroups((current) => new Set(current).add(waypoint.group));
    setActiveFunctionId(waypoint.id);
    setSelectedRange(range);
    navigateToRange(range);
  }

  function navigateToSection(section: SourceSectionAnchor): void {
    setActiveFunctionId(null);
    setSelectedRange(null);
    navigateToRange({ startLine: section.line, endLine: section.line });
  }

  function clearWaypointSelection(): void {
    setActiveFunctionId(null);
    setSelectedRange(null);
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

  function minimapStyle(waypoint: SourceFunctionWaypoint): CSSProperties {
    return {
      top: `${((waypoint.startLine - 1) / totalLines) * 100}%`,
      height: `${Math.max(1.5, (waypoint.lineCount / totalLines) * 100)}%`
    };
  }

  function renderCodeLine(line: string, lineIndex: number) {
    const lineNumber = lineIndex + 1;
    const tokens = highlightedSource?.tokens[lineIndex];
    const isFocused = Boolean(selectedRange && lineNumber >= selectedRange.startLine && lineNumber <= selectedRange.endLine);
    const isSelectedStart = inspection.functions.some(
      (waypoint) => waypoint.id === activeFunctionId && waypoint.startLine === lineNumber
    );

    return (
      <span
        className={`source-modal__line ${isFocused ? "is-focused" : ""} ${isSelectedStart ? "is-selected-start" : ""}`.trim()}
        key={lineNumber}
        ref={(element) => {
          if (element) {
            lineRefs.current.set(lineNumber, element);
          } else {
            lineRefs.current.delete(lineNumber);
          }
        }}
      >
        <span className="source-modal__line-number" aria-hidden="true">{lineNumber}</span>
        <span className="source-modal__line-code">
          {tokens
            ? tokens.map((token, tokenIndex) => (
                <span key={tokenIndex} style={tokenStyle(token)}>{token.content}</span>
              ))
            : line || " "}
        </span>
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
            !target.closest(".source-modal__function-card, .source-modal__minimap-waypoint")
          ) {
            clearWaypointSelection();
          }
        }}
      >
        <header className="source-modal__header">
          <div>
            <div className="source-modal__label">Operational Source Inspection</div>
            <h2 id="source-modal-title">{file.label}</h2>
            <div id="source-modal-path" className="source-modal__path">{file.path}</div>
          </div>
          <button type="button" className="source-modal__close" aria-label="Close source inspection" onClick={onClose} autoFocus>
            <span />
            <span />
          </button>
        </header>
        <div className="source-modal__meta">
          <span>{languageLabel}</span>
          {typeof file.metadata?.linesOfCode === "number" ? <span>{file.metadata.linesOfCode} LOC</span> : null}
          {typeof file.metadata?.functionCount === "number" ? <span>{file.metadata.functionCount} Functions</span> : null}
          <span className={highlightedSource ? "is-highlighted" : ""}>
            {isHighlighting ? "Tokenizing" : highlightedSource ? "Syntax Color" : "Raw Text"}
          </span>
          {runtimeContext?.inActiveCorridor ? <span className="is-runtime">Runtime Corridor</span> : null}
        </div>
        <div className="source-modal__surface">
          <section className="source-modal__implementation" aria-label="Source implementation">
            <div className="source-modal__pane-label">Implementation Field</div>
            <div className="source-modal__code-frame">
              <div className="source-modal__viewport" ref={codeViewportRef} onScroll={updateViewportMarker}>
                {sourceText === null ? (
                  <p className="source-modal__empty">Source text is unavailable. Analyze the repository again.</p>
                ) : sourceText.length === 0 ? (
                  <p className="source-modal__empty">Empty file.</p>
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
                    />
                  ))}
                </nav>
              ) : null}
            </div>
          </section>
          <aside className="source-modal__navigation" aria-label="Operational navigation">
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
                      : "No navigable JavaScript functions detected."}
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
                            className={`source-modal__function-card ${isActive ? "is-expanded" : ""}`}
                            key={waypoint.id}
                          >
                            <button
                              type="button"
                              className={`source-modal__function ${isActive ? "is-active" : ""}`.trim()}
                              onClick={() => navigateToFunction(waypoint)}
                            >
                              <span className="source-modal__function-name">{waypoint.name}()</span>
                              <span className="source-modal__function-meta">{waypoint.lineCount}L / line {waypoint.startLine}</span>
                            </button>
                            {isActive ? (
                              <div className="source-modal__circulation" aria-label={`Data circulation for ${waypoint.name}`}>
                                <section>
                                  <h5>Inputs</h5>
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
                                </section>
                                <section>
                                  <h5>Outputs</h5>
                                  {waypoint.outputs.length > 0 ? waypoint.outputs.map((output) => (
                                    <div className="source-modal__flow-row" key={`${output.line}-${output.expression}`}>
                                      <code>{output.expression}</code>
                                      {output.type ? <span>{output.type}</span> : null}
                                      <small>line {output.line}{output.async ? " / async" : ""}</small>
                                    </div>
                                  )) : <div className="source-modal__flow-empty">None detected</div>}
                                </section>
                                <section>
                                  <h5>State Updates</h5>
                                  {waypoint.stateUpdates.length > 0 ? waypoint.stateUpdates.map((update) => (
                                    <div className="source-modal__flow-row" key={`${update.setter}-${update.line}`}>
                                      <code>{update.setter}({update.arguments.join(", ")})</code>
                                      <span>{update.state}</span>
                                      <small>line {update.line}</small>
                                    </div>
                                  )) : <div className="source-modal__flow-empty">None detected</div>}
                                </section>
                                <section>
                                  <h5>Calls</h5>
                                  {waypoint.calls.length > 0 ? waypoint.calls.map((call) => (
                                    <div className="source-modal__flow-row" key={`${call.name}-${call.line}`}>
                                      <code>{call.name}()</code>
                                      <small>line {call.line}</small>
                                      {call.definitionPath ? (
                                        <div className="source-modal__flow-link">
                                          <b>from</b>
                                          <span>{call.definitionPath}</span>
                                        </div>
                                      ) : null}
                                    </div>
                                  )) : <div className="source-modal__flow-empty">None detected</div>}
                                </section>
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
