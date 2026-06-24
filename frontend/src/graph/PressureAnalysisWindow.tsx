import type { ReactNode } from "react";
import { FloatingWindow } from "../ui/FloatingWindow";

type ForecastInspectionMode = "weather" | "simulation";
type PressureRuleAction =
  | "function-loc"
  | "function-inventory"
  | "dependency-placeholder"
  | "complexity-placeholder"
  | "under-construction";
type PressureInvestigationKind = Exclude<PressureRuleAction, "function-inventory">;

export interface PressureRuleCard {
  id: string;
  title: string;
  description: string;
  current: string;
  target: string;
  tone: "warning" | "critical";
  action: PressureRuleAction;
}

export interface PressureFunctionRow {
  id: string;
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  source: string;
  tone: "stable" | "warning" | "critical";
}

export interface ActivePressureInvestigation {
  kind: PressureInvestigationKind;
  title: string;
}

interface PressureAnalysisWindowProps {
  open: boolean;
  mode: ForecastInspectionMode;
  fileName: string;
  filePath?: string;
  pressureSignalCount: number;
  pressureRules: PressureRuleCard[];
  activePressureInvestigation: ActivePressureInvestigation | null;
  selectedPressureFunctionRows: PressureFunctionRow[];
  selectedPressureFunction: PressureFunctionRow | null;
  onInvestigateRule: (rule: PressureRuleCard) => void;
  onBackToRules: () => void;
  onSelectPressureFunctionId: (id: string) => void;
  onClose: () => void;
  children?: ReactNode;
}

function pressureWindowIcon() {
  return (
    <span className="pressure-analysis-window__icon" aria-hidden="true">
      <span className="pressure-analysis-window__icon-dot" />
    </span>
  );
}

export function PressureAnalysisWindow({
  open,
  mode,
  fileName,
  filePath,
  pressureSignalCount,
  pressureRules,
  activePressureInvestigation,
  selectedPressureFunctionRows,
  selectedPressureFunction,
  onInvestigateRule,
  onBackToRules,
  onSelectPressureFunctionId,
  onClose
}: PressureAnalysisWindowProps) {
  return (
    <FloatingWindow
      windowId="pressure-analysis"
      title={mode === "simulation" ? "Refactor Investigation" : "Pressure Analysis"}
      centerLabel={fileName}
      open={open}
      icon={pressureWindowIcon()}
      onClose={onClose}
    >
      <div className="pressure-analysis-window__body">
        <header className="pressure-analysis-window__header">
          <div>
            <strong>{fileName}</strong>
            {filePath ? <span>{filePath}</span> : null}
          </div>
          <div className="pressure-analysis-window__signals">
            <span>Pressure Signals</span>
            <strong>{pressureSignalCount}</strong>
          </div>
        </header>

        {activePressureInvestigation ? (
          <section className="metadata-panel__analysis-surface pressure-analysis-window__surface" aria-label={`${activePressureInvestigation.title} investigation`}>
            <div className="metadata-panel__analysis-surface-header">
              <button type="button" className="metadata-panel__analysis-back" onClick={onBackToRules}>
                Rules
              </button>
              <div>
                <span>Investigation</span>
                <strong>{activePressureInvestigation.title}</strong>
              </div>
            </div>

            {activePressureInvestigation.kind === "function-loc" ? (
              <div className="metadata-panel__function-investigation">
                <div className="metadata-panel__function-rail" aria-label="Function rail">
                  {selectedPressureFunctionRows.map((row) => (
                    <button
                      type="button"
                      className={`metadata-panel__function-rail-row metadata-panel__function-rail-row--${row.tone} ${selectedPressureFunction?.id === row.id ? "is-active" : ""}`.trim()}
                      key={row.id}
                      onClick={() => onSelectPressureFunctionId(row.id)}
                    >
                      <span>{row.name}</span>
                      <strong>{row.lineCount}</strong>
                    </button>
                  ))}
                </div>
                <div className="metadata-panel__function-source">
                  {selectedPressureFunction ? (
                    <>
                      <div className="metadata-panel__function-source-head">
                        <strong>{selectedPressureFunction.name}</strong>
                        <span>{selectedPressureFunction.lineCount} LOC</span>
                        <span>CC {selectedPressureFunction.cyclomaticComplexity}</span>
                        <span>Cog {selectedPressureFunction.cognitiveComplexity}</span>
                      </div>
                      <pre>
                        <code>{selectedPressureFunction.source || "Source unavailable."}</code>
                      </pre>
                    </>
                  ) : (
                    <div className="metadata-panel__analysis-empty">No functions found.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="metadata-panel__analysis-placeholder-panel">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <strong>
                  {activePressureInvestigation.kind === "dependency-placeholder"
                    ? "Dependency Investigation"
                    : activePressureInvestigation.kind === "complexity-placeholder"
                      ? "Complexity Investigation"
                      : "UNDER CONSTRUCTION"}
                </strong>
                <span>This investigation surface is planned but not implemented yet.</span>
              </div>
            )}
          </section>
        ) : (
          <section className="metadata-panel__analysis-rule-list pressure-analysis-window__rules" aria-label="Active pressure rules">
            {pressureRules.length > 0 ? (
              pressureRules.map((rule) => (
                <article className={`metadata-panel__analysis-rule-card metadata-panel__analysis-rule-card--${rule.tone}`} key={rule.id}>
                  <div className="metadata-panel__analysis-rule-main">
                    <span className="metadata-panel__analysis-rule-dot" aria-hidden="true" />
                    <div>
                      <h3>{rule.title}</h3>
                      <p>{rule.description}</p>
                    </div>
                  </div>
                  <div className="metadata-panel__analysis-rule-values">
                    <div>
                      <span>Current</span>
                      <strong>{rule.current}</strong>
                    </div>
                    <div>
                      <span>Target</span>
                      <strong>{rule.target}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="metadata-panel__analysis-investigate"
                    onClick={() => onInvestigateRule(rule)}
                  >
                    Investigate
                  </button>
                </article>
              ))
            ) : (
              <div className="metadata-panel__analysis-empty">No active pressure rules.</div>
            )}
          </section>
        )}
      </div>
    </FloatingWindow>
  );
}
