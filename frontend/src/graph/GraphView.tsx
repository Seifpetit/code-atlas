import {
  lazy,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  ReactFlow,
  SelectionMode,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowInstance
} from "@xyflow/react";
import type { AtlasEdge, AtlasGraph, AtlasNode, SavedMapViewState } from "../api";
import { historyBadgeFor } from "../history/historyUtils";
import { extractArchitecturalLandmarks, snapToLandmark } from "../time/landmarkExtraction";
import { RawHistoryInspector } from "../time/RawHistoryInspector";
import { TemporalScrubber } from "../time/TemporalScrubber";
import { buildTemporalStates, nodeTemporalPressure } from "../time/temporalPressure";
import { buildRuntimeChain } from "../runtime/buildRuntimeChain";
import { layoutRuntimeCorridor } from "../runtime/runtimeLayout";
import { RuntimeScrubber } from "../runtime/RuntimeScrubber";
import { inactiveRuntimeState, type RuntimeState } from "../runtime/runtimeTypes";
import { RuntimeXRayOverlay } from "../runtime/RuntimeXRayOverlay";
import { useFloatingWindowManager } from "../ui/FloatingWindow";
import { visualStateStyle } from "./attention/applyNodeVisualState";
import { composeNodeVisualState } from "./attention/composeNodeVisualState";
import { PressureAnalysisWindow, PRESSURE_ANALYSIS_WINDOW_ID } from "./PressureAnalysisWindow";
import { inspectSource } from "./sourceInspection";
import type { ClusteringMode } from "./clustering";
import { edgeTypes } from "./edgeTypes";
import { minimapColorForFile } from "./filePalette";
import { buildFileForecast, type ForecastModel } from "./forecastModel";
import { layoutStructuralContext, type AtlasFlowEdge, type AtlasFlowNode } from "./layout";
import { nodeTypes } from "./nodeTypes";

const SourceCodeModal = lazy(() =>
  import("./SourceCodeModal").then((module) => ({ default: module.SourceCodeModal }))
);

interface GraphViewProps {
  graph: AtlasGraph | null;
  searchTerm: string;
  clusteringMode: ClusteringMode;
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  onAnalyzeRepoUrl: (repoUrl: string) => void;
  onAnalyzeExampleRepo: (repoUrl: string, label: string) => void;
  isAnalyzing?: boolean;
  analyzeElapsedLabel?: string;
  isEstimatingAnalyze?: boolean;
  analyzeEstimateLabel?: string | null;
  analyzeEstimateMeta?: string | null;
  analyzeProgressPercent?: number;
  analyzeProgressMode?: "circle" | "line";
  analyzeProgressTransitionMs?: number;
  initialViewState?: SavedMapViewState | null;
  viewStateKey?: string | null;
  onViewStateChange?: (viewState: SavedMapViewState | null) => void;
  githubConnected?: boolean;
  githubUserLogin?: string;
  onConnectGitHub?: () => void;
}

interface StructuralState {
  currentContextId: string | null;
  focusedNodeId: string | null;
  tracedEdgeIds: string[];
  pageIndex: number;
  breadcrumbPath: string[];
  clusteringMode: ClusteringMode;
}

interface BudgetedRelationship {
  edge: AtlasFlowEdge;
  direction: "incoming" | "outgoing";
  otherNode: AtlasNode | null;
  otherFlowId: string | null;
  count: number;
  score: number;
}

interface RelationshipCollection {
  relationships: BudgetedRelationship[];
  totalIncoming: number;
  totalOutgoing: number;
}

interface RelationshipTraceSet {
  incoming: BudgetedRelationship[];
  outgoing: BudgetedRelationship[];
}

interface PinnedTraceAnchor {
  nodeId: string;
  corridorIndex: number;
}

interface PinnedTraceGroup {
  key: string;
  edgeIds: string[];
  folderRelationCounts: Record<string, number>;
  anchor: PinnedTraceAnchor;
}

type ManualNodePositions = Record<string, { x: number; y: number }>;
type ClientPoint = { x: number; y: number };

interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type ForecastInspectionMode = "weather" | "simulation";
type ForecastSignalSeverity = "danger" | "warn" | "info";
type ForecastFlowIcon = "files" | "function" | "chart-line" | "git-commit" | "cloud-storm" | "alert";
type ForecastFlowTone = "calm" | "warm" | "storm" | "muted";
type ForecastFlagSeverity = "high" | "medium";
type SimulationMetricTone = "healthy" | "warning" | "critical";
type PressureSimulationPhase = "centering" | "folders" | "files" | "edges";
type PressureResponsibilityKey = "runtime" | "state" | "transforms" | "relations" | "helpers" | "other";
type PressureRuleAction = "function-loc" | "function-inventory" | "dependency-placeholder" | "complexity-placeholder" | "under-construction";
type PressureInvestigationKind = Exclude<PressureRuleAction, "function-inventory">;
type SourceModalInventoryMode = "function-count" | null;

interface PressureSimulationState {
  nodeId: string;
  phase: PressureSimulationPhase;
}

interface PressureResponsibilityOrbit {
  label: string;
  percent: number;
  offsetX: number;
  offsetY: number;
}

interface MetadataWeatherForecast {
  status: "Stable" | "Warming" | "Under Pressure" | "High Risk" | "Storm Forming";
  summary: string;
  signals: string[];
}

interface ForecastSignalCard {
  icon: ForecastFlowIcon;
  label: string;
  value: string;
  tone: ForecastFlowTone;
  fillPercent: number;
}

interface ForecastFlagRow {
  text: string;
  severity: ForecastFlagSeverity;
}

interface SimulationPressureDimension {
  label: string;
  value: string;
  tone: SimulationMetricTone;
  fillPercent: number;
}

interface SimulationResponsibility {
  label: string;
  shortLabel: string;
  percent: number;
  color: string;
  satelliteX: number;
  satelliteY: number;
  satelliteSize: number;
}

interface SimulationModuleCard {
  status: "KEEP" | "NEW";
  title: string;
  role: string;
}

interface SimulationImpactMetric {
  label: string;
  direction: "up" | "down";
  before: string;
  after: string;
  beforeLevel: number;
  afterLevel: number;
}

interface ForecastFlowData {
  pressurePercent: number;
  weatherVerdict: string;
  weatherVerdictTone: ForecastFlowTone;
  signalCards: ForecastSignalCard[];
  weatherFlagRows: ForecastFlagRow[];
  simulationResponsibilities: SimulationResponsibility[];
  simulationPressureDimensions: SimulationPressureDimension[];
  simulationModuleCards: SimulationModuleCard[];
  simulationImpactMetrics: SimulationImpactMetric[];
  consequenceTitle: string;
  consequenceBody: string;
}

type EngineeringBasisState = "ok" | "watch";

interface EngineeringBasisRow {
  rule: string;
  label: string;
  state: EngineeringBasisState;
  reason: string;
}

interface PressureRuleCard {
  id: string;
  title: string;
  description: string;
  current: string;
  target: string;
  action: PressureRuleAction;
  tone: "warning" | "critical";
}

interface ActivePressureInvestigation {
  kind: PressureInvestigationKind;
  title: string;
}

interface PressureFunctionRow {
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

const FORECAST_FLOW_QUESTIONS: Record<ForecastInspectionMode, string[]> = {
  weather: ["Should I care?", "Why is it flagged?", "What if I ignore it?"],
  simulation: ["What's wrong?", "How to split it?", "Is it worth it?"]
};

const FORECAST_FLOW_NEXT_LABELS: Record<ForecastInspectionMode, string[]> = {
  weather: ["Why? \u2192", "What if ignored? \u2192", ""],
  simulation: ["How? \u2192", "Release Pressure \u2192", ""]
};

const PRESSURE_SIMULATION_PHASE_ORDER: PressureSimulationPhase[] = ["centering", "folders", "files", "edges"];
const SIMULATION_PERCENTAGES = [42, 25, 18, 15];
const SIMULATION_COLORS = ["#ef4444", "#f59e0b", "#2dd4bf", "#a78bfa"];
const SIMULATION_SATELLITE_POSITIONS = [
  { x: 50, y: 11.5 },
  { x: 50, y: 88.5 },
  { x: 15, y: 50 },
  { x: 85, y: 50 }
];
const SIMULATION_FALLBACK_RESPONSIBILITIES = ["Auth logic", "Session", "Logging", "Email"];
const SIMULATION_FALLBACK_MODULES: SimulationModuleCard[] = [
  { status: "NEW", title: "authService.ts", role: "auth logic" },
  { status: "NEW", title: "sessionManager.ts", role: "session state" },
  { status: "NEW", title: "emailService.ts", role: "email sending" },
  { status: "NEW", title: "loggingService.ts", role: "logging" }
];
const PRESSURE_RESPONSIBILITY_ORBIT: Record<PressureResponsibilityKey, PressureResponsibilityOrbit> = {
  runtime: { label: "Runtime", percent: 25, offsetX: 340, offsetY: -220 },
  state: { label: "State", percent: 18, offsetX: 340, offsetY: 220 },
  transforms: { label: "Transforms", percent: 15, offsetX: -340, offsetY: -220 },
  relations: { label: "Relations", percent: 12, offsetX: -340, offsetY: 220 },
  helpers: { label: "Helpers", percent: 10, offsetX: 0, offsetY: 340 },
  other: { label: "Extracted", percent: 10, offsetX: 0, offsetY: -340 }
};
const PRESSURE_FUNCTION_LOC_TARGET = 60;
const PRESSURE_FUNCTION_COUNT_TARGET = 25;
const PRESSURE_IMPORT_COUNT_TARGET = 10;
const PRESSURE_CYCLOMATIC_TARGET = 15;
const PRESSURE_COGNITIVE_TARGET = 20;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function pressureSimulationPhaseAtLeast(phase: PressureSimulationPhase, target: PressureSimulationPhase): boolean {
  return PRESSURE_SIMULATION_PHASE_ORDER.indexOf(phase) >= PRESSURE_SIMULATION_PHASE_ORDER.indexOf(target);
}

function fileExtensionFromTitle(title: string): string {
  const normalized = title.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() ?? normalized;
  const dotIndex = fileName.lastIndexOf(".");

  return dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function folderNameFromSuggestedTitle(title: string): string {
  const normalized = title.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  return parts.length > 1 ? parts[0] : "helpers";
}

function fileNameFromSuggestedTitle(title: string): string {
  const normalized = title.replace(/\\/g, "/");

  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function pressureResponsibilityKeyForBlock(block: ForecastModel["suggested"][number]): PressureResponsibilityKey {
  const signal = `${block.title}\n${block.items.join("\n")}`.toLowerCase();

  if (/\bruntime\b|\btrace\b|\bflow\b|\bcorridor\b/.test(signal)) {
    return "runtime";
  }

  if (/\bhooks?\b|\bstate\b|\buse[A-Z]/.test(block.title) || /\bstate\b|\breducer\b/.test(signal)) {
    return "state";
  }

  if (/\btransforms?\b|\btransform\b|\bnormalize\b|\bmap\b|\bbuild\b|\bhelpers?\b/.test(signal)) {
    return signal.includes("helper") && !signal.includes("transform") ? "helpers" : "transforms";
  }

  if (/\brelations?\b|\bdependencies\b|\bdependency\b|\bimports?\b|\bconnection\b/.test(signal)) {
    return "relations";
  }

  if (/\bhelpers?\b|\blocal helper\b/.test(signal)) {
    return "helpers";
  }

  return "other";
}

function pressureResponsibilityForBlock(block: ForecastModel["suggested"][number]): PressureResponsibilityOrbit {
  return PRESSURE_RESPONSIBILITY_ORBIT[pressureResponsibilityKeyForBlock(block)];
}

function toneForThreshold(value: number, amberThreshold: number, redThreshold: number): ForecastFlowTone {
  if (value > redThreshold) {
    return "storm";
  }

  if (value > amberThreshold) {
    return "warm";
  }

  return "calm";
}

function simulationMetricTone(value: number, warningThreshold: number, criticalThreshold: number): SimulationMetricTone {
  if (value > criticalThreshold) {
    return "critical";
  }

  if (value > warningThreshold) {
    return "warning";
  }

  return "healthy";
}

function simulationResponsibilityLabel(item: string): string {
  const normalized = item.trim();

  if (!normalized) {
    return "Responsibility";
  }

  if (normalized.length <= 18) {
    return normalized
      .replace(/\bruntime flow\b/i, "Runtime")
      .replace(/\bstate changes\b/i, "State")
      .replace(/\bdata transforms\b/i, "Transforms")
      .replace(/\bdependency routing\b/i, "Dependencies")
      .replace(/\blocal helper logic\b/i, "Helpers");
  }

  return normalized
    .replace(/\s+(logic|changes|routing|flow|transforms)$/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

function simulationShortLabel(label: string): string {
  const normalized = label
    .replace(/\s+logic$/i, "")
    .replace(/\s+state$/i, "")
    .replace(/\s+flow$/i, "")
    .replace(/\s+transforms$/i, "")
    .trim();

  if (/auth/i.test(normalized)) {
    return "Auth";
  }

  if (/session|state/i.test(normalized)) {
    return "Session";
  }

  if (/log/i.test(normalized)) {
    return "Log";
  }

  if (/email|mail/i.test(normalized)) {
    return "Email";
  }

  return normalized.split(/\s+/)[0] || "Role";
}

function simulationResponsibilitiesFor(forecast: ForecastModel): SimulationResponsibility[] {
  const forecastItems = forecast.current.items
    .map((item) => simulationResponsibilityLabel(item))
    .filter((item) => item.length > 0);
  const labels = forecastItems.length >= 4
    ? forecastItems.slice(0, 4)
    : SIMULATION_FALLBACK_RESPONSIBILITIES;

  return labels.map((label, index) => {
    const percent = SIMULATION_PERCENTAGES[index] ?? Math.max(10, Math.round(100 / labels.length));
    const position = SIMULATION_SATELLITE_POSITIONS[index] ?? SIMULATION_SATELLITE_POSITIONS[0];

    return {
      label,
      shortLabel: simulationShortLabel(label),
      percent,
      color: SIMULATION_COLORS[index] ?? "#2dd4bf",
      satelliteX: position.x,
      satelliteY: position.y,
      satelliteSize: Math.round(52 + percent * 0.72)
    };
  });
}

function averageCyclomaticComplexity(file: AtlasNode): number {
  const functions = file.metadata?.functionWaypoints ?? [];

  if (functions.length === 0) {
    return 0;
  }

  return functions.reduce(
    (total, waypoint) => total + Number(waypoint.cyclomaticComplexity ?? 1),
    0
  ) / functions.length;
}

function moduleNameForResponsibility(label: string, index: number): string {
  const normalized = label.toLowerCase();

  if (normalized.includes("auth")) {
    return "authService.ts";
  }

  if (normalized.includes("session") || normalized.includes("state")) {
    return "sessionManager.ts";
  }

  if (normalized.includes("email") || normalized.includes("mail")) {
    return "emailService.ts";
  }

  if (normalized.includes("log")) {
    return "loggingService.ts";
  }

  const compact = label
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part, partIndex) => partIndex === 0 ? part.toLowerCase() : part[0].toUpperCase() + part.slice(1))
    .join("");

  return `${compact || `releasedModule${index + 1}`}.ts`;
}

function simulationModuleCardsFor(
  forecast: ForecastModel,
  responsibilities: SimulationResponsibility[]
): SimulationModuleCard[] {
  const usesFallbackResponsibilities =
    responsibilities.map((responsibility) => responsibility.label).join("|") === SIMULATION_FALLBACK_RESPONSIBILITIES.join("|");
  const keepRole = "rendering only";

  if (usesFallbackResponsibilities) {
    return [
      {
        status: "KEEP",
        title: forecast.current.title,
        role: "rendering only"
      },
      ...SIMULATION_FALLBACK_MODULES
    ];
  }

  const suggestedModules = forecast.suggested.slice(1, 5).map((block): SimulationModuleCard => ({
    status: "NEW",
    title: block.title,
    role: block.items.join(", ")
  }));
  const filledModules = suggestedModules.length >= 4
    ? suggestedModules
    : [
        ...suggestedModules,
        ...responsibilities
          .slice(suggestedModules.length, 4)
          .map((responsibility, index): SimulationModuleCard => ({
            status: "NEW",
            title: moduleNameForResponsibility(responsibility.label, index),
            role: responsibility.label.toLowerCase()
          }))
      ].slice(0, 4);

  return [
    {
      status: "KEEP",
      title: forecast.current.title,
      role: keepRole
    },
    ...filledModules
  ];
}

function maxCyclomaticComplexity(file: AtlasNode): number {
  return (file.metadata?.functionWaypoints ?? []).reduce(
    (maxComplexity, waypoint) => Math.max(maxComplexity, Number(waypoint.cyclomaticComplexity ?? 0)),
    0
  );
}

function maxCognitiveComplexity(file: AtlasNode): number {
  return (file.metadata?.functionWaypoints ?? []).reduce(
    (maxComplexity, waypoint) => Math.max(maxComplexity, Number(waypoint.cognitiveComplexity ?? 0)),
    0
  );
}

function maxFunctionLineSpan(file: AtlasNode): number {
  return (file.metadata?.functionWaypoints ?? []).reduce(
    (maxSpan, waypoint) => Math.max(maxSpan, Math.max(0, waypoint.endLine - waypoint.startLine + 1)),
    0
  );
}

function functionWaypointDisplayId(
  waypoint: NonNullable<NonNullable<AtlasNode["metadata"]>["functionWaypoints"]>[number],
  index: number
): string {
  return waypoint.waypointId ?? `function-${index}-${waypoint.startLine}`;
}

function pressureFunctionRowsForFile(file: AtlasNode): PressureFunctionRow[] {
  const sourceLines = typeof file.sourceText === "string" ? file.sourceText.split(/\r?\n/) : [];

  return (file.metadata?.functionWaypoints ?? [])
    .map((waypoint, index): PressureFunctionRow => {
      const lineCount = Math.max(1, waypoint.endLine - waypoint.startLine + 1);
      const cyclomaticComplexity = Number(waypoint.cyclomaticComplexity ?? 0);
      const cognitiveComplexity = Number(waypoint.cognitiveComplexity ?? 0);
      const tone =
        lineCount >= PRESSURE_FUNCTION_LOC_TARGET * 2 ||
        cyclomaticComplexity >= PRESSURE_CYCLOMATIC_TARGET ||
        cognitiveComplexity >= PRESSURE_COGNITIVE_TARGET
          ? "critical"
          : lineCount > PRESSURE_FUNCTION_LOC_TARGET
            ? "warning"
            : "stable";

      return {
        id: functionWaypointDisplayId(waypoint, index),
        name: waypoint.name,
        startLine: waypoint.startLine,
        endLine: waypoint.endLine,
        lineCount,
        cyclomaticComplexity,
        cognitiveComplexity,
        source: sourceLines.slice(waypoint.startLine - 1, waypoint.endLine).join("\n"),
        tone
      };
    })
    .sort((left, right) =>
      right.lineCount - left.lineCount ||
      right.cyclomaticComplexity - left.cyclomaticComplexity ||
      left.startLine - right.startLine
    );
}

function strongestComplexityForFile(file: AtlasNode): { current: number; target: number; label: string } {
  const cyclomatic = maxCyclomaticComplexity(file);
  const cognitive = maxCognitiveComplexity(file);

  if (cognitive / PRESSURE_COGNITIVE_TARGET > cyclomatic / PRESSURE_CYCLOMATIC_TARGET) {
    return { current: cognitive, target: PRESSURE_COGNITIVE_TARGET, label: "Cognitive" };
  }

  return { current: cyclomatic, target: PRESSURE_CYCLOMATIC_TARGET, label: "Cyclomatic" };
}

function pressureRuleCardsForFile(
  file: AtlasNode,
  forecast: ForecastModel | null | undefined,
  importedByCount: number
): PressureRuleCard[] {
  const functions = pressureFunctionRowsForFile(file);
  const largestFunction = functions[0] ?? null;
  const functionCount = Number(file.metadata?.functionCount ?? functions.length);
  const importCount = Number(file.metadata?.importCount ?? 0);
  const complexity = strongestComplexityForFile(file);
  const cards: PressureRuleCard[] = [];
  const coveredSignals = new Set<string>();

  if (largestFunction && largestFunction.lineCount > PRESSURE_FUNCTION_LOC_TARGET) {
    cards.push({
      id: "function-loc",
      title: "Large Function",
      description: "One function is larger than the review unit.",
      current: `${largestFunction.lineCount} LOC`,
      target: `${PRESSURE_FUNCTION_LOC_TARGET} LOC`,
      action: "function-loc",
      tone: largestFunction.lineCount >= PRESSURE_FUNCTION_LOC_TARGET * 2 ? "critical" : "warning"
    });
    coveredSignals.add("Large Function");
  }

  if (functionCount > PRESSURE_FUNCTION_COUNT_TARGET) {
    cards.push({
      id: "function-count",
      title: "Function Sprawl",
      description: "The file has too many local function surfaces.",
      current: `${functionCount} functions`,
      target: `${PRESSURE_FUNCTION_COUNT_TARGET} functions`,
      action: "function-inventory",
      tone: functionCount >= PRESSURE_FUNCTION_COUNT_TARGET * 2 ? "critical" : "warning"
    });
    coveredSignals.add("Function Sprawl");
  }

  if (importCount > PRESSURE_IMPORT_COUNT_TARGET) {
    cards.push({
      id: "import-count",
      title: "Dependency Surface",
      description: "Imports exceed the local dependency target.",
      current: `${importCount} imports`,
      target: `${PRESSURE_IMPORT_COUNT_TARGET} imports`,
      action: "dependency-placeholder",
      tone: importCount >= PRESSURE_IMPORT_COUNT_TARGET * 2 ? "critical" : "warning"
    });
    coveredSignals.add("Dependency Concentration");
  }

  if (complexity.current > complexity.target) {
    cards.push({
      id: "complexity",
      title: "Complexity Pressure",
      description: "A function exceeds the complexity target.",
      current: `${complexity.label} ${complexity.current}`,
      target: `${complexity.target}`,
      action: "complexity-placeholder",
      tone: complexity.current >= complexity.target * 1.5 ? "critical" : "warning"
    });
    coveredSignals.add("High Complexity");
  }

  for (const signal of pressureSignalLabelsForFile(file, forecast, importedByCount)) {
    if (coveredSignals.has(signal)) {
      continue;
    }

    cards.push({
      id: `future:${signal.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: signal,
      description: "Investigation surface planned.",
      current: "Active signal",
      target: "Planned",
      action: "under-construction",
      tone: "warning"
    });
    coveredSignals.add(signal);
  }

  return cards;
}

function compactPressureSignal(signal: string): string {
  const normalizedSignal = signal.toLowerCase();

  if (normalizedSignal.includes("large function")) {
    return "Large Function";
  }

  if (normalizedSignal.includes("health score") || normalizedSignal.includes("health stress")) {
    return "Health Stress";
  }

  if (normalizedSignal.includes("hard to follow") || normalizedSignal.includes("complexity")) {
    return "High Complexity";
  }

  if (normalizedSignal.includes("responsibil") || normalizedSignal.includes("several jobs")) {
    return "Responsibility Overlap";
  }

  if (
    normalizedSignal.includes("connect") ||
    normalizedSignal.includes("dependency") ||
    normalizedSignal.includes("many files")
  ) {
    return "Dependency Concentration";
  }

  if (normalizedSignal.includes("many functions") || normalizedSignal.includes("function count")) {
    return "Function Sprawl";
  }

  if (normalizedSignal.includes("moving parts") || normalizedSignal.includes("orchestration")) {
    return "Orchestration Hub";
  }

  return signal.replace(/\.$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function pressureSignalLabelsForFile(
  file: AtlasNode,
  forecast: ForecastModel | null | undefined,
  importedByCount: number
): string[] {
  const functions = file.metadata?.functionWaypoints ?? [];
  const maxFunctionSpan = maxFunctionLineSpan(file);
  const maxCyclomatic = maxCyclomaticComplexity(file);
  const maxCognitive = maxCognitiveComplexity(file);
  const functionCount = Number(file.metadata?.functionCount ?? functions.length);
  const dependencySurface = Number(file.metadata?.importCount ?? 0) + importedByCount;
  const responsibilityCount = forecast?.current.items.length ?? 0;
  const signals: string[] = [];

  if (maxFunctionSpan >= 60) {
    signals.push("Large Function");
  }

  if (responsibilityCount >= 3) {
    signals.push("Responsibility Overlap");
  }

  if (maxCyclomatic >= 15 || maxCognitive >= 20) {
    signals.push("High Complexity");
  }

  if (dependencySurface >= 16) {
    signals.push("Dependency Concentration");
  }

  if (functionCount >= 25) {
    signals.push("Function Sprawl");
  }

  if (functions.some((waypoint) => waypoint.calls.length >= 10 || waypoint.stateUpdates.length >= 4)) {
    signals.push("Orchestration Hub");
  }

  if (file.healthTier === "critical" || (typeof file.healthScore === "number" && file.healthScore < 45)) {
    signals.push("Health Stress");
  }

  signals.push(...(forecast?.pressureSignals ?? []).map(compactPressureSignal));

  return uniqueStrings(signals).slice(0, 4);
}

function signalSeverityForRow(signal: string): ForecastFlagSeverity {
  return metadataForecastSignalSeverity(signal) === "info" ? "medium" : "high";
}

function flagRowsForSignals(signals: string[], maxRows: number): ForecastFlagRow[] {
  return signals
    .map((signal) => ({
      text: signal,
      severity: signalSeverityForRow(signal)
    }))
    .sort((left, right) => (
      (right.severity === "high" ? 1 : 0) - (left.severity === "high" ? 1 : 0) ||
      left.text.localeCompare(right.text)
    ))
    .slice(0, maxRows);
}

function consequenceTextForSignal(signal: string): { title: string; body: string } {
  const normalizedSignal = signal.toLowerCase();

  if (normalizedSignal.includes("dependency") || normalizedSignal.includes("coupling") || normalizedSignal.includes("neighbor")) {
    return {
      title: "Dependency pressure is likely to spread.",
      body: "If this file keeps absorbing connections, future changes may require more surrounding files to be inspected. Review scope can grow even when a change looks local."
    };
  }

  if (normalizedSignal.includes("responsibil")) {
    return {
      title: "Responsibility accumulation will make intent harder to read.",
      body: "If unrelated concerns keep landing here, reviewers will need to hold more context at once. Small edits can become harder to classify and test."
    };
  }

  if (normalizedSignal.includes("size") || normalizedSignal.includes("function") || normalizedSignal.includes("complexity")) {
    return {
      title: "Review surface is likely to keep expanding.",
      body: "If growth continues, the file will take longer to scan and reason about. Larger review surfaces also make automated edits harder to constrain."
    };
  }

  return {
    title: "Pressure can accumulate quietly.",
    body: "If nothing changes, the current trajectory may make this area more expensive to review later. The signal is directional, not a verdict."
  };
}

function ForecastFlowIcon({ icon }: { icon: ForecastFlowIcon }) {
  if (icon === "files") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4h9l3 3v12H8z" />
        <path d="M17 4v4h4" />
        <path d="M4 8v12h12" />
      </svg>
    );
  }

  if (icon === "function") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 20c2-6 2-10 0-16" />
        <path d="M4 8h8" />
        <path d="M14 10l6 6" />
        <path d="M20 10l-6 6" />
      </svg>
    );
  }

  if (icon === "chart-line") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19h16" />
        <path d="M5 15l4-4 4 2 6-7" />
        <path d="M15 6h4v4" />
      </svg>
    );
  }

  if (icon === "git-commit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h5" />
        <path d="M15 12h5" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (icon === "cloud-storm") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 18a4 4 0 1 1 1-7 5 5 0 0 1 9.6 1.8A3 3 0 0 1 17 18H7z" />
        <path d="M13 14l-2 4h3l-2 4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4l9 16H3z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function metadataForecastSignalSeverity(signal: string): ForecastSignalSeverity {
  const normalizedSignal = signal.toLowerCase();

  if (
    normalizedSignal.includes("health score") ||
    normalizedSignal.includes("health stress") ||
    normalizedSignal.includes("storm") ||
    normalizedSignal.includes("high risk") ||
    normalizedSignal.includes("spreading") ||
    normalizedSignal.includes("high complexity")
  ) {
    return "danger";
  }

  if (
    normalizedSignal.includes("connect") ||
    normalizedSignal.includes("import") ||
    normalizedSignal.includes("many files")
  ) {
    return "info";
  }

  return "warn";
}

function metadataWeatherForecastFor(file: AtlasNode, forecast: ForecastModel, importedByCount: number): MetadataWeatherForecast {
  const linesOfCode = Number(file.metadata?.linesOfCode ?? 0);
  const importCount = Number(file.metadata?.importCount ?? 0);
  const functionCount = Number(file.metadata?.functionCount ?? file.metadata?.functionWaypoints?.length ?? 0);
  const responsibilityCount = forecast.current.items.length;
  const dependencySurface = importCount + importedByCount;
  const healthScore = typeof file.healthScore === "number" ? file.healthScore : 100;
  const functions = file.metadata?.functionWaypoints ?? [];
  const signals: string[] = [];
  let score = 0;

  if (responsibilityCount >= 3) {
    score += 2;
    signals.push("This file is accumulating responsibilities.");
  } else if (responsibilityCount >= 2) {
    score += 1;
    signals.push("Responsibility growth is starting to concentrate here.");
  }

  if (linesOfCode >= 420) {
    score += 3;
    signals.push("File size is large enough that continued growth will raise review complexity.");
  } else if (linesOfCode >= 180) {
    score += 2;
    signals.push("Growing file size is beginning to increase review cost.");
  } else if (linesOfCode >= 80) {
    score += 1;
  }

  if (dependencySurface >= 16) {
    score += 3;
    signals.push("Dependency count is concentrating around this file.");
  } else if (dependencySurface >= 8) {
    score += 2;
    signals.push("Coupling growth is likely to affect neighboring files.");
  } else if (dependencySurface >= 4) {
    score += 1;
  }

  if (functionCount >= 24) {
    score += 2;
    signals.push("Function count is increasing the amount reviewers must keep in memory.");
  } else if (functionCount >= 12) {
    score += 1;
  }

  if (healthScore < 45) {
    score += 3;
    signals.push("Pressure is likely to spread if this area keeps taking changes.");
  } else if (healthScore < 70) {
    score += 1;
    signals.push("Complexity is warming but not yet critical.");
  }

  if (functions.some((waypoint) => waypoint.calls.length >= 10 || waypoint.stateUpdates.length >= 4)) {
    score += 2;
    signals.push("Large orchestration paths are forming inside the file.");
  }

  if (signals.length === 0) {
    signals.push("This area remains stable.");
  }

  const status =
    score >= 9
      ? "Storm Forming"
      : score >= 7
        ? "High Risk"
        : score >= 4
          ? "Under Pressure"
          : score >= 2
            ? "Warming"
            : "Stable";
  const summary: Record<MetadataWeatherForecast["status"], string> = {
    Stable: "This area remains stable. If current patterns continue, review pressure is unlikely to grow quickly.",
    Warming: "This file is beginning to accumulate pressure. If growth continues at the current pace, review complexity is likely to increase.",
    "Under Pressure": "Pressure is concentrating here. Continued growth is likely to make nearby changes harder to review.",
    "High Risk": "This file is carrying enough pressure that future edits may spread complexity into neighboring files.",
    "Storm Forming": "Multiple pressure signals are converging. If nothing changes, this area is likely to become harder to review and modify."
  };

  return {
    status,
    summary: summary[status],
    signals: signals.slice(0, 5)
  };
}

interface SelectionMarqueeGesture {
  active: boolean;
  start: ClientPoint | null;
  pointer: ClientPoint | null;
}

const COMPRESSION_REASON_LABELS = new Map<string, string>([
  ["very-low-loc", "very low LOC"],
  ["tiny-wrapper", "tiny wrapper"],
  ["conventional-support-file", "support file convention"],
  ["pass-through-export", "pass-through exports"],
  ["package-gateway", "package gateway imports"]
]);
const SELECTION_AUTOPAN_EDGE_DISTANCE = 72;
const SELECTION_AUTOPAN_MAX_STEP = 16;
const SECONDARY_CORRIDOR_PREFIX = "__linked-corridor__:";
const SECONDARY_CORRIDOR_GAP_X = 420;
const CORRIDOR_MAP_COLUMNS = 3;
const CORRIDOR_MAP_ROW_GAP_Y = 260;
const RELATIONSHIP_BRIDGE_COLORS: Record<RelationshipFollowDirection, string> = {
  imports: "#2dd4bf",
  "imported-by": "#facc15"
};
const FUNCTION_METADATA_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py"]);
type ArchitecturalWeight = "LOW" | "MEDIUM" | "HIGH";
type RefactorRiskTier = "safe" | "foundation" | "careful" | "danger" | "mixed" | "quiet";
type SecondaryPanelRegion = "role" | "file-types" | "actions" | "memory";
type OperationalRoleKind =
  | "low-signal"
  | "configuration"
  | "support"
  | "gateway"
  | "dependency-hub"
  | "runtime"
  | "rendering"
  | "leaf"
  | "isolated"
  | "connected";

interface OperationalRole {
  kind: OperationalRoleKind;
  label: string;
}

interface RefactorRiskPressure {
  tier: RefactorRiskTier;
  label: string;
  reasons: string[];
  payoffScore: number;
  riskScore: number;
}

const REFACTOR_RISK_LABELS: Record<RefactorRiskTier, string> = {
  safe: "Start Here",
  foundation: "Foundation",
  careful: "Needs Isolation",
  danger: "Critical Surface",
  mixed: "High-Leverage Risk",
  quiet: "Stable"
};

const REFACTOR_RISK_LEGEND_TIERS: RefactorRiskTier[] = [
  "safe",
  "foundation",
  "careful",
  "mixed",
  "danger",
  "quiet"
];

interface RegionalFileTypeCount {
  label: string;
  count: number;
}

interface RegionalSummary {
  directChildCount: number;
  fileCount: number;
  folderCount: number;
  totalLinesOfCode?: number;
  totalFunctionCount?: number;
  fileTypes: RegionalFileTypeCount[];
}

interface ConnectedFileTarget {
  node: AtlasNode;
  direction: "imports" | "imported-by";
  line: number | null;
  edgeIds: string[];
}

interface ConnectedFileGroup {
  folderPath: string;
  label: string;
  depthDelta: number;
  targets: ConnectedFileTarget[];
}

interface ConnectedFileGroupsByDirection {
  imports: ConnectedFileGroup[];
  importedBy: ConnectedFileGroup[];
}

type RelationshipFollowDirection = "imports" | "imported-by";
type FileMetadataSectionId = "structure";

interface RelationshipFollowContext {
  direction: RelationshipFollowDirection;
}

interface InteractionResidue {
  focusCount: number;
  runtimeActivationCount: number;
}

interface PendingContextCamera {
  contextId: string | null;
  zoom: number;
}

interface LinkedCorridorState {
  contextId: string | null;
  focusedNodeId: string;
  pageIndex: number;
}

interface CorridorLinkState {
  originCorridorIndex: number;
  originNodeId: string;
  targetCorridorIndex: number;
  targetNodeId: string;
  direction: RelationshipFollowDirection;
  subdued?: boolean;
}

interface CorridorPlacementDraft {
  corridorIndex: number;
  nodes: AtlasFlowNode[];
  bounds: LayoutBounds;
  column: number;
  row: number;
}

interface CollapsibleSemanticRegionProps {
  title: string;
  summary: string;
  isExpanded: boolean;
  hasResidue?: boolean;
  onToggle: () => void;
  children: ReactNode;
}

interface CollapsibleMetadataSectionProps {
  id: FileMetadataSectionId;
  title: string;
  summary?: string;
  isCollapsed: boolean;
  className?: string;
  onToggle: (sectionId: FileMetadataSectionId) => void;
  children: ReactNode;
}

function CollapsibleSemanticRegion({
  title,
  summary,
  isExpanded,
  hasResidue = false,
  onToggle,
  children
}: CollapsibleSemanticRegionProps) {
  return (
    <section className={`operational-panel__region operational-panel__layer ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
      <button
        type="button"
        className="operational-panel__layer-toggle"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <span className="operational-panel__layer-title">{title}</span>
        <span className={`operational-panel__layer-summary ${hasResidue ? "has-residue" : ""}`.trim()}>{summary}</span>
        <span className="operational-panel__layer-chevron" aria-hidden="true" />
      </button>
      {isExpanded ? <div className="operational-panel__layer-content">{children}</div> : null}
    </section>
  );
}

function CollapsibleMetadataSection({
  id,
  title,
  summary,
  isCollapsed,
  className = "",
  onToggle,
  children
}: CollapsibleMetadataSectionProps) {
  const bodyId = `metadata-section-${id}`;

  return (
    <section
      className={`metadata-panel__section metadata-panel__section--collapsible ${isCollapsed ? "is-collapsed" : "is-expanded"} ${className}`.trim()}
      aria-label={title}
    >
      <button
        type="button"
        className="metadata-panel__section-toggle"
        aria-expanded={!isCollapsed}
        aria-controls={bodyId}
        onClick={() => onToggle(id)}
      >
        <span className="metadata-panel__section-title">{title}</span>
        {summary ? <span className="metadata-panel__section-summary">{summary}</span> : null}
        <span className="metadata-panel__section-chevron" aria-hidden="true" />
      </button>
      {!isCollapsed ? (
        <div className="metadata-panel__section-body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function formatMetricNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function refactorRiskPressureFor(node: AtlasNode, importedByCount: number): RefactorRiskPressure {
  const linesOfCode = Number(node.metadata?.linesOfCode ?? 0);
  const functionCount = Number(node.metadata?.functionCount ?? 0);
  const importCount = Number(node.metadata?.importCount ?? 0);
  const functions = node.metadata?.functionWaypoints ?? [];
  const sourceText = node.sourceText ?? "";
  let payoffScore = 0;
  let riskScore = 0;
  const reasons: string[] = [];

  if (node.metadata?.compressionLevel === "low-signal") {
    payoffScore -= 2;
    reasons.push("low-signal support file");
  }

  if (linesOfCode >= 420) {
    payoffScore += 3;
    reasons.push("large file");
  } else if (linesOfCode >= 180) {
    payoffScore += 2;
    reasons.push("medium-large file");
  } else if (linesOfCode >= 80) {
    payoffScore += 1;
  }

  if (functionCount >= 16) {
    payoffScore += 3;
    reasons.push("many functions");
  } else if (functionCount >= 8) {
    payoffScore += 2;
    reasons.push("several functions");
  } else if (functionCount >= 3) {
    payoffScore += 1;
  }

  if (typeof node.healthScore === "number" && node.healthScore < 40) {
    payoffScore += 2;
    reasons.push("low health score");
  }

  if (functions.some((waypoint) => (waypoint.duplicateOf?.length ?? 0) > 0)) {
    payoffScore += 2;
    reasons.push("duplicate function body");
  }

  if (importCount + importedByCount >= 10) {
    payoffScore += 2;
    riskScore += 1;
    reasons.push("high dependency surface");
  } else if (importCount + importedByCount >= 5) {
    payoffScore += 1;
  }

  if (importedByCount >= 6) {
    riskScore += 3;
    reasons.push("widely imported");
  } else if (importedByCount >= 3) {
    riskScore += 2;
    reasons.push("shared dependency");
  } else if (importedByCount > 0) {
    riskScore += 1;
  }

  if (/\b(?:useEffect|useLayoutEffect|useReducer|useRef|useState)\b/.test(sourceText)) {
    riskScore += 2;
    reasons.push("owns React state/effects");
  }

  if (/\b(?:onClick|onPointer|onMouse|onKey|onSubmit|onChange|onDrag|NodeMouseHandler|PointerEvent|MouseEvent)\b/.test(sourceText)) {
    riskScore += 2;
    reasons.push("owns interaction handlers");
  }

  if (/\b(?:async|await|Promise|fetch|setTimeout|setInterval|requestAnimationFrame)\b/.test(sourceText)) {
    riskScore += 1;
    reasons.push("async or timed behavior");
  }

  if (/\b(?:localStorage|sessionStorage|viewState|saveGraph|loadSavedGraph|shareSavedGraph|cookie|auth|OAuth)\b/i.test(`${node.path}\n${sourceText}`)) {
    riskScore += 2;
    reasons.push("persistence or auth surface");
  }

  if (/\b(?:ReactFlow|useReactFlow|setViewport|fitView|setCenter)\b/.test(sourceText)) {
    riskScore += 3;
    reasons.push("graph viewport/control surface");
  }

  if (node.metadata?.staticEntrypoint) {
    riskScore += 2;
    reasons.push("static entrypoint");
  }

  const tier: RefactorRiskTier =
    payoffScore <= 0 && riskScore <= 1
      ? "quiet"
      : payoffScore >= 5 && riskScore >= 4
        ? "mixed"
        : riskScore >= 4
          ? "danger"
          : riskScore >= 2
            ? "careful"
            : payoffScore >= 3
              ? "safe"
              : "foundation";
  return {
    tier,
    label: REFACTOR_RISK_LABELS[tier],
    reasons: reasons.length > 0 ? reasons : ["low coupling and modest size"],
    payoffScore: Math.max(0, payoffScore),
    riskScore
  };
}

function compressionDescription(node: AtlasNode): string {
  const reasons = node.metadata?.compressionReasons ?? [];
  return reasons
    .map((reason) => COMPRESSION_REASON_LABELS.get(reason) ?? reason)
    .join(", ");
}

function hasFunctionMetadata(node: AtlasNode): boolean {
  return FUNCTION_METADATA_EXTENSIONS.has(String(node.metadata?.extension ?? "").toLowerCase());
}

function panelObjectType(node: AtlasNode): "FILE" | "FOLDER" {
  if (node.type === "file") {
    return "FILE";
  }

  return "FOLDER";
}

function panelTitle(node: AtlasNode): string {
  return node.type === "file" ? node.label : `${node.label}/`;
}

function orientationPath(node: AtlasNode): string {
  if (node.type === "file") {
    return node.parent ? `${node.parent}/` : "repository root/";
  }

  return node.parent ? `${node.path}/` : "repository root/";
}

function parentDirectoryPath(node: AtlasNode): string {
  return node.type === "file"
    ? (node.parent ? `${node.parent}/` : "repository root/")
    : (node.parent ? `${node.path}/` : "repository root/");
}

function folderPathForFile(node: AtlasNode): string {
  return node.parent ?? "";
}

function folderLabel(folderPath: string): string {
  return folderPath ? `${folderPath}/` : "repository root/";
}

function fileStem(node: AtlasNode): string {
  const extension = String(node.metadata?.extension ?? "");
  return extension && node.label.endsWith(extension)
    ? node.label.slice(0, -extension.length).toLowerCase()
    : node.label.toLowerCase();
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

function formatRelativeAge(dateValue: string): string {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

interface FileRoleSummary {
  label: string;
  description: string;
}

function codebaseRoleFor(node: AtlasNode, inspection: ReturnType<typeof inspectSource>, importedByCount: number): FileRoleSummary {
  const importCount = Number(node.metadata?.importCount ?? 0);
  const exportedFunctions = inspection.functions.filter((waypoint) => waypoint.exported || waypoint.public).length;
  const stem = fileStem(node);
  const compressionReasons = node.metadata?.compressionReasons ?? [];
  const supportFile =
    compressionReasons.includes("conventional-support-file") ||
    compressionReasons.includes("pass-through-export") ||
    compressionReasons.includes("package-gateway") ||
    stem === "types" ||
    stem === "constants" ||
    stem === "config" ||
    stem === "configuration";

  if (stem === "main" || stem === "index" || stem === "app") {
    return {
      label: "Entry point",
      description: `This file sits at the front of the graph: it is imported by ${importedByCount} file${importedByCount === 1 ? "" : "s"} and carries a small export surface.`
    };
  }

  if (supportFile) {
    return {
      label: "Config",
      description: `This file behaves like supporting configuration or a gateway module, with ${importCount} import${importCount === 1 ? "" : "s"} and ${exportedFunctions} exported function${exportedFunctions === 1 ? "" : "s"}.`
    };
  }

  if (importedByCount >= 4 && importCount <= 4) {
    return {
      label: "Shared utility",
      description: `Many files depend on this module while it keeps a compact outbound surface of ${importCount} import${importCount === 1 ? "" : "s"}.`
    };
  }

  if (importCount >= 4 && importedByCount <= 1) {
    return {
      label: "Coordinator",
      description: `This file pulls in ${importCount} dependency${importCount === 1 ? "" : "ies"} and fans work out through a narrow downstream graph.`
    };
  }

  if (exportedFunctions > 0 && importedByCount > 0) {
    return {
      label: "Shared utility",
      description: `The graph treats this as a reusable module because it exports callable surface and is consumed by ${importedByCount} file${importedByCount === 1 ? "" : "s"}.`
    };
  }

  if (importCount === 0 && importedByCount === 0) {
    return {
      label: "Isolated",
      description: "This file has no recorded dependency traffic, so it sits outside the main graph flow."
    };
  }

  return {
    label: importedByCount > importCount ? "Shared utility" : "Support module",
    description: importedByCount > importCount
      ? `This file is pulled into more places than it reaches outward, which makes it read as shared code in the graph.`
      : `This file keeps a modest dependency surface and mostly acts as support for adjacent nodes.`
  };
}

function architecturalWeightFor(node: AtlasNode, importedByCount: number): ArchitecturalWeight {
  const linesOfCode = Number(node.metadata?.linesOfCode ?? 0);
  const functionCount = Number(node.metadata?.functionCount ?? 0);
  const imports = Number(node.metadata?.importCount ?? 0);
  let score = 0;

  score += linesOfCode >= 300 ? 3 : linesOfCode >= 100 ? 2 : linesOfCode >= 30 ? 1 : 0;
  score += functionCount >= 12 ? 3 : functionCount >= 5 ? 2 : functionCount >= 2 ? 1 : 0;
  score += imports >= 8 ? 2 : imports >= 3 ? 1 : 0;
  score += importedByCount >= 8 ? 3 : importedByCount >= 3 ? 2 : importedByCount > 0 ? 1 : 0;

  if (score >= 7) {
    return "HIGH";
  }

  return score >= 3 ? "MEDIUM" : "LOW";
}

function operationalRolesFor(node: AtlasNode, importedByCount: number): OperationalRole[] {
  const stem = fileStem(node);
  const imports = Number(node.metadata?.importCount ?? 0);
  const normalizedPath = node.path.toLowerCase();
  const roles: OperationalRole[] = [];

  if (node.metadata?.compressionLevel === "low-signal") {
    roles.push({ kind: "low-signal", label: "Rule-classified low-signal file" });
  }

  if (stem === "config") {
    roles.push({ kind: "configuration", label: "Configuration file" });
  } else if (stem === "types" || stem === "constants") {
    roles.push({ kind: "support", label: "Structural support file" });
  } else if (stem === "index") {
    roles.push({ kind: "gateway", label: "Index or export gateway" });
  } else if (stem === "__init__") {
    roles.push({ kind: "gateway", label: "Python package gateway" });
  }

  if (importedByCount >= 5) {
    roles.push({ kind: "dependency-hub", label: "Dependency hub candidate" });
  }

  if (/(^|[\/_-])runtime([\/_.-]|$)/.test(normalizedPath)) {
    roles.push({ kind: "runtime", label: "Runtime-related candidate" });
  } else if (/(graph|layout|render|projection|component|view)/.test(normalizedPath)) {
    roles.push({ kind: "rendering", label: "Rendering or projection candidate" });
  }

  if (roles.length === 0 && imports === 0 && importedByCount > 0) {
    roles.push({ kind: "leaf", label: "Leaf dependency candidate" });
  }

  if (roles.length === 0) {
    roles.push(
      imports === 0 && importedByCount === 0
        ? { kind: "isolated", label: "Unconnected implementation file" }
        : { kind: "connected", label: "Connected implementation file" }
    );
  }

  return roles.filter((role, index) => roles.findIndex((candidate) => candidate.kind === role.kind) === index).slice(0, 2);
}

function regionalSummaryFor(region: AtlasNode, graph: AtlasGraph): RegionalSummary {
  const files = graph.nodes.filter((node) => node.type === "file" && ownsPath(region, node.path));
  const folders = graph.nodes.filter((node) => node.type === "folder" && node.id !== region.id && ownsPath(region, node.path));
  const parsedFunctionFiles = files.filter(hasFunctionMetadata);
  const fileTypeCounts = new Map<string, number>();

  for (const file of files) {
    const extension = String(file.metadata?.extension ?? "").toLowerCase();
    const label = extension || "[no extension]";
    fileTypeCounts.set(label, (fileTypeCounts.get(label) ?? 0) + 1);
  }

  const totalLinesOfCode = files.length > 0 && files.every((node) => typeof node.metadata?.linesOfCode === "number")
    ? files.reduce((total, node) => total + Number(node.metadata?.linesOfCode), 0)
    : undefined;
  const totalFunctionCount = parsedFunctionFiles.length > 0 &&
      parsedFunctionFiles.every((node) => typeof node.metadata?.functionCount === "number")
    ? parsedFunctionFiles.reduce((total, node) => total + Number(node.metadata?.functionCount), 0)
    : undefined;

  return {
    directChildCount: Number(region.metadata?.childCount ?? 0),
    fileCount: files.length,
    folderCount: folders.length,
    totalLinesOfCode,
    totalFunctionCount,
    fileTypes: [...fileTypeCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
  };
}

function isLineageNode(node: AtlasFlowNode): boolean {
  const data = node.data as AtlasNode;

  return typeof data.lineageKind === "string";
}

function isStructuralNode(node: AtlasFlowNode): node is AtlasFlowNode {
  const data = node.data as AtlasNode;

  if (isLineageNode(node)) {
    return false;
  }

  return node.type === "folder" || node.type === "file";
}

function canEnter(node: AtlasNode): boolean {
  return node.type === "folder" && Number(node.metadata?.childCount ?? 0) > 0;
}

function ownsPath(owner: AtlasNode, path: string): boolean {
  if (owner.type === "file") {
    return owner.path === path;
  }

  return path === owner.path || path.startsWith(`${owner.path}/`);
}

function laneOffsetFor(index: number, total: number): number {
  const laneGap = 14;
  return (index - (total - 1) / 2) * laneGap;
}

function corridorFocusNodeIds(nodes: AtlasFlowNode[], contextId: string | null): string[] {
  const currentAnchorId = contextId ? `__lineage__:${contextId}` : null;
  const visibleChildren = nodes.filter((node) => !isLineageNode(node));
  const topChildY = visibleChildren.length > 0
    ? Math.min(...visibleChildren.map((node) => node.position.y))
    : null;
  const branchHeads = topChildY === null
    ? []
    : visibleChildren.filter((node) => node.position.y <= topChildY + 12);

  return nodes
    .filter((node) => Boolean(currentAnchorId && node.id === currentAnchorId) || branchHeads.some((head) => head.id === node.id))
    .map((node) => node.id);
}

function corridorFlowId(corridorIndex: number, id: string): string {
  return corridorIndex === 0 ? id : `${SECONDARY_CORRIDOR_PREFIX}${corridorIndex}:${id}`;
}

function flowNodeRealId(node: AtlasFlowNode): string {
  const data = node.data as AtlasNode;
  return typeof data.realNodeId === "string" ? data.realNodeId : node.id;
}

function visibleFlowEndpointForPath(
  nodePath: string,
  visibleNodes: AtlasFlowNode[],
  visibleFlowIdByRealId: Map<string, string>
): string | null {
  const exactFlowId = visibleFlowIdByRealId.get(nodePath);
  if (exactFlowId) {
    return exactFlowId;
  }

  const ownerNode = visibleNodes.find((node) => {
    const data = node.data as AtlasNode;
    return data.type === "folder" && ownsPath(data, nodePath);
  });

  return ownerNode?.id ?? null;
}

function lineageKey(node: AtlasFlowNode): string | null {
  const data = node.data as AtlasNode;
  return typeof data.lineageKind === "string" ? String(data.id) : null;
}

function primaryLineageFlowId(key: string): string {
  return key === "root" ? "__lineage__:root" : `__lineage__:${key}`;
}

function duplicateKeyForNode(node: AtlasFlowNode): string | null {
  const data = node.data as AtlasNode;
  const key = lineageKey(node);
  if (key) {
    return `lineage:${key}`;
  }

  return data.type === "folder" ? `folder:${flowNodeRealId(node)}` : null;
}

function layoutBounds(nodes: AtlasFlowNode[]): LayoutBounds {
  if (nodes.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  return nodes.reduce((bounds, node) => {
    const width = Number(node.width ?? node.initialWidth ?? (node.data as AtlasNode).layoutWidth ?? 0);
    const height = Number(node.height ?? node.initialHeight ?? (node.data as AtlasNode).layoutHeight ?? 0);

    return {
      minX: Math.min(bounds.minX, node.position.x),
      maxX: Math.max(bounds.maxX, node.position.x + width),
      minY: Math.min(bounds.minY, node.position.y),
      maxY: Math.max(bounds.maxY, node.position.y + height)
    };
  }, {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  });
}

function corridorMapPosition(corridorIndex: number): { column: number; row: number } {
  const row = Math.floor(corridorIndex / CORRIDOR_MAP_COLUMNS);
  const positionInRow = corridorIndex % CORRIDOR_MAP_COLUMNS;
  const column = row % 2 === 0
    ? positionInRow
    : CORRIDOR_MAP_COLUMNS - 1 - positionInRow;

  return { column, row };
}

function remapCorridorEdge(edge: AtlasFlowEdge, corridorIndex: number): AtlasFlowEdge {
  return {
    ...edge,
    id: corridorFlowId(corridorIndex, edge.id),
    source: corridorFlowId(corridorIndex, edge.source),
    target: corridorFlowId(corridorIndex, edge.target),
    data: {
      ...(edge.data ?? {}),
      corridor: "secondary"
    }
  };
}

function remapCorridorLineageEdge(edge: AtlasFlowEdge, corridorIndex: number, visibleFlowIdByRealId: Map<string, string>): AtlasFlowEdge | null {
  const source = visibleFlowIdByRealId.get(edge.source) ?? corridorFlowId(corridorIndex, edge.source);
  const target = visibleFlowIdByRealId.get(edge.target) ?? corridorFlowId(corridorIndex, edge.target);

  if (source === target) {
    return null;
  }

  return {
    ...edge,
    id: corridorFlowId(corridorIndex, edge.id),
    source,
    target,
    data: {
      ...(edge.data ?? {}),
      corridor: "secondary"
    }
  };
}

function pageIndexContainingNode(graph: AtlasGraph, contextId: string | null, nodeId: string): number {
  const firstPage = layoutStructuralContext(graph, contextId, 0);
  if (firstPage.nodes.some((node) => node.id === nodeId)) {
    return 0;
  }

  for (let pageIndex = 1; pageIndex < firstPage.totalPages; pageIndex += 1) {
    const page = layoutStructuralContext(graph, contextId, pageIndex);
    if (page.nodes.some((node) => node.id === nodeId)) {
      return page.currentPage;
    }
  }

  return 0;
}

function relationshipScore(activeNode: AtlasNode, otherNode: AtlasNode | null): number {
  if (!otherNode) {
    return 0;
  }

  if ((activeNode.parent ?? null) === (otherNode.parent ?? null)) {
    return 300;
  }

  return 200;
}

function graphEndpointPath(endpointId: string, graphNodeById: Map<string, AtlasNode>): string {
  return graphNodeById.get(endpointId)?.path ?? endpointId;
}

function endpointBelongsToNode(endpointId: string, owner: AtlasNode, graphNodeById: Map<string, AtlasNode>): boolean {
  const endpointPath = graphEndpointPath(endpointId, graphNodeById);

  return owner.id === endpointId || owner.path === endpointPath || ownsPath(owner, endpointPath);
}

function corridorIndexForFlowNode(flowNode: AtlasFlowNode): number {
  return Number((flowNode.data as AtlasNode).corridorIndex ?? 0);
}

function preferredVisibleOwner(
  candidates: Array<{ id: string; node: AtlasNode; corridorIndex: number; pathLength: number }>,
  preferredCorridorIndex: number,
  preferDeepestPath = false
): { id: string; node: AtlasNode } | null {
  const [preferred] = candidates.slice().sort((a, b) => {
    if (preferDeepestPath && b.pathLength !== a.pathLength) {
      return b.pathLength - a.pathLength;
    }

    const corridorPreference = Number(b.corridorIndex === preferredCorridorIndex) - Number(a.corridorIndex === preferredCorridorIndex);
    if (corridorPreference !== 0) {
      return corridorPreference;
    }

    if (!preferDeepestPath && b.pathLength !== a.pathLength) {
      return b.pathLength - a.pathLength;
    }

    const corridorDistance = Math.abs(a.corridorIndex - preferredCorridorIndex) - Math.abs(b.corridorIndex - preferredCorridorIndex);
    if (corridorDistance !== 0) {
      return corridorDistance;
    }

    return a.id.localeCompare(b.id);
  });

  return preferred ? { id: preferred.id, node: preferred.node } : null;
}

function visibleOwnerForEndpoint(
  endpointId: string,
  graphNodeById: Map<string, AtlasNode>,
  visibleNodes: AtlasFlowNode[],
  preferredCorridorIndex: number
): { id: string; node: AtlasNode } | null {
  const endpointPath = graphEndpointPath(endpointId, graphNodeById);
  const exactOwners: Array<{ id: string; node: AtlasNode; corridorIndex: number; pathLength: number }> = [];
  const folderOwners: Array<{ id: string; node: AtlasNode; corridorIndex: number; pathLength: number }> = [];

  for (const flowNode of visibleNodes) {
    if (isLineageNode(flowNode)) {
      continue;
    }

    const node = flowNode.data as AtlasNode;
    const realNodeId = flowNodeRealId(flowNode);
    const isExactNode = realNodeId === endpointId || node.id === endpointId || node.path === endpointPath;
    const corridorIndex = corridorIndexForFlowNode(flowNode);

    if (node.type === "file" && isExactNode) {
      exactOwners.push({ id: flowNode.id, node, corridorIndex, pathLength: node.path.length });
      continue;
    }

    if (node.type === "folder" && ownsPath(node, endpointPath)) {
      folderOwners.push({ id: flowNode.id, node, corridorIndex, pathLength: node.path.length });
    }
  }

  return preferredVisibleOwner(exactOwners, preferredCorridorIndex) ?? preferredVisibleOwner(folderOwners, preferredCorridorIndex, true);
}

function relationshipEdgeKey(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

function parseRelationshipEdgeId(edgeId: string): { source: string; target: string } | null {
  if (!edgeId.startsWith("context:")) {
    return null;
  }

  const body = edgeId.slice("context:".length);
  const separatorIndex = body.indexOf("->");

  if (separatorIndex < 0) {
    return null;
  }

  return {
    source: body.slice(0, separatorIndex),
    target: body.slice(separatorIndex + 2)
  };
}

function syntheticRelationshipEdge(sourceId: string, targetId: string, count: number): AtlasFlowEdge {
  return {
    id: `context:${sourceId}->${targetId}`,
    source: sourceId,
    target: targetId,
    type: "structural",
    animated: false,
    zIndex: 0,
    data: {
      kind: "context-import",
      importCount: count
    },
    style: {}
  };
}

function collectRelationships(
  graphEdges: AtlasEdge[],
  graphNodeById: Map<string, AtlasNode>,
  visibleNodes: AtlasFlowNode[],
  activeNodeId: string,
  activeCorridorIndex: number
): RelationshipCollection {
  const activeNode =
    graphNodeById.get(activeNodeId) ??
    visibleNodes.map((node) => node.data as AtlasNode).find((node) => node.id === activeNodeId);
  const relatedByKey = new Map<string, BudgetedRelationship>();
  let totalIncoming = 0;
  let totalOutgoing = 0;

  if (!activeNode) {
    return {
      relationships: [],
      totalIncoming: 0,
      totalOutgoing: 0
    };
  }

  for (const graphEdge of graphEdges) {
    const sourceInsideActive = endpointBelongsToNode(graphEdge.source, activeNode, graphNodeById);
    const targetInsideActive = endpointBelongsToNode(graphEdge.target, activeNode, graphNodeById);

    if (sourceInsideActive === targetInsideActive) {
      continue;
    }

    const direction: "incoming" | "outgoing" = sourceInsideActive ? "outgoing" : "incoming";
    if (direction === "outgoing") {
      totalOutgoing += 1;
    } else {
      totalIncoming += 1;
    }

    const sourceOwner = visibleOwnerForEndpoint(
      graphEdge.source,
      graphNodeById,
      visibleNodes,
      activeCorridorIndex
    );
    const targetOwner = visibleOwnerForEndpoint(
      graphEdge.target,
      graphNodeById,
      visibleNodes,
      activeCorridorIndex
    );

    if (!sourceOwner || !targetOwner || sourceOwner.id === targetOwner.id) {
      continue;
    }

    const edgeKey = relationshipEdgeKey(sourceOwner.id, targetOwner.id);
    const otherOwner = direction === "outgoing" ? targetOwner : sourceOwner;
    const existing = relatedByKey.get(edgeKey);
    const count = (existing?.count ?? 0) + 1;
    const renderedEdge = syntheticRelationshipEdge(sourceOwner.id, targetOwner.id, count);
    const edge: AtlasFlowEdge = {
      ...renderedEdge,
      data: {
        ...(renderedEdge.data ?? {}),
        importCount: count
      }
    };

    relatedByKey.set(edgeKey, {
      edge,
      direction,
      otherNode: otherOwner.node,
      otherFlowId: otherOwner.id,
      count,
      score: relationshipScore(activeNode, otherOwner.node) + count
    });
  }

  const relationships = [...relatedByKey.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (a.direction !== b.direction) {
      return a.direction === "outgoing" ? -1 : 1;
    }

    return (a.otherNode?.path ?? a.edge.id).localeCompare(b.otherNode?.path ?? b.edge.id);
  });

  return {
    relationships,
    totalIncoming,
    totalOutgoing
  };
}

function budgetRelationships(
  collection: RelationshipCollection,
  limit: number
): {
  visible: BudgetedRelationship[];
  hiddenIncoming: number;
  hiddenOutgoing: number;
  totalIncoming: number;
  totalOutgoing: number;
} {
  const visible = collection.relationships.slice(0, limit);
  const visibleIncoming = visible.reduce((count, relation) => count + (relation.direction === "incoming" ? relation.count : 0), 0);
  const visibleOutgoing = visible.reduce((count, relation) => count + (relation.direction === "outgoing" ? relation.count : 0), 0);

  return {
    visible,
    hiddenIncoming: Math.max(0, collection.totalIncoming - visibleIncoming),
    hiddenOutgoing: Math.max(0, collection.totalOutgoing - visibleOutgoing),
    totalIncoming: collection.totalIncoming,
    totalOutgoing: collection.totalOutgoing
  };
}

function traceRelationships(collection: RelationshipCollection): RelationshipTraceSet {
  return {
    incoming: collection.relationships.filter((relationship) => relationship.direction === "incoming"),
    outgoing: collection.relationships.filter((relationship) => relationship.direction === "outgoing")
  };
}

function folderTraceCountsForRelationships(relationships: BudgetedRelationship[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const relationship of relationships) {
    if (relationship.otherNode?.type !== "folder") {
      continue;
    }

    const countKey = relationship.otherFlowId ?? relationship.otherNode.id;
    counts[countKey] = (counts[countKey] ?? 0) + relationship.count;
  }

  return counts;
}

function mergeRelationCountMaps(countMaps: Array<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};

  for (const countMap of countMaps) {
    for (const [nodeId, count] of Object.entries(countMap)) {
      merged[nodeId] = (merged[nodeId] ?? 0) + count;
    }
  }

  return merged;
}

export function GraphView({
  graph,
  searchTerm,
  clusteringMode,
  repoUrl,
  onRepoUrlChange,
  onAnalyzeRepoUrl,
  onAnalyzeExampleRepo,
  isAnalyzing = false,
  analyzeElapsedLabel,
  isEstimatingAnalyze = false,
  analyzeEstimateLabel,
  analyzeEstimateMeta,
  analyzeProgressPercent = 0,
  analyzeProgressMode = "line",
  analyzeProgressTransitionMs = 420,
  initialViewState = null,
  viewStateKey = null,
  onViewStateChange,
  githubConnected = false,
  githubUserLogin,
  onConnectGitHub
}: GraphViewProps) {
  const { bringToFront } = useFloatingWindowManager();
  const [selectedNode, setSelectedNode] = useState<AtlasNode | null>(null);
  const [sourceModalFile, setSourceModalFile] = useState<AtlasNode | null>(null);
  const [sourceModalInventoryMode, setSourceModalInventoryMode] = useState<SourceModalInventoryMode>(null);
  const [metadataForecastNodeId, setMetadataForecastNodeId] = useState<string | null>(null);
  const [pressureAnalysisWindowOpen, setPressureAnalysisWindowOpen] = useState(false);
  const [activePressureInvestigation, setActivePressureInvestigation] = useState<ActivePressureInvestigation | null>(null);
  const [selectedPressureFunctionId, setSelectedPressureFunctionId] = useState<string | null>(null);
  const [pressureSimulation, setPressureSimulation] = useState<PressureSimulationState | null>(null);
  const [filePanelView, setFilePanelView] = useState<"metadata" | "wires">("metadata");
  const [currentContextId, setCurrentContextId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [tracedEdgeIds, setTracedEdgeIds] = useState<string[]>([]);
  const [tracedFolderRelationCounts, setTracedFolderRelationCounts] = useState<Record<string, number>>({});
  const [pinnedTraceGroups, setPinnedTraceGroups] = useState<PinnedTraceGroup[]>([]);
  const [selectedRuntimeFileId, setSelectedRuntimeFileId] = useState<string | null>(null);
  const [expandedPanelRegion, setExpandedPanelRegion] = useState<{ nodeId: string | null; region: SecondaryPanelRegion | null }>({
    nodeId: null,
    region: null
  });
  const [interactionResidueByNodeId, setInteractionResidueByNodeId] = useState<Record<string, InteractionResidue>>({});
  const [temporalIndex, setTemporalIndex] = useState(0);
  const [focusedLandmarkId, setFocusedLandmarkId] = useState<string | null>(null);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);
  const [selectionToolActive, setSelectionToolActive] = useState(false);
  const [refactorRiskMode, setRefactorRiskMode] = useState(false);
  const [refactorRiskScanActive, setRefactorRiskScanActive] = useState(false);
  const [collapsedFileSections, setCollapsedFileSections] = useState<FileMetadataSectionId[]>([]);
  const [collapsedFileConnectionSections, setCollapsedFileConnectionSections] = useState<RelationshipFollowDirection[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [linkedCorridors, setLinkedCorridors] = useState<LinkedCorridorState[]>([]);
  const [corridorLinks, setCorridorLinks] = useState<CorridorLinkState[]>([]);
  const [selectedCorridorIndex, setSelectedCorridorIndex] = useState(0);
  const [manualNodePositions, setManualNodePositions] = useState<ManualNodePositions>({});
  const [runtimeNodePositions, setRuntimeNodePositions] = useState<ManualNodePositions>({});
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<AtlasFlowNode, AtlasFlowEdge> | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(inactiveRuntimeState);
  const [runtimePlaybackActive, setRuntimePlaybackActive] = useState(false);
  const [viewportSnapshot, setViewportSnapshot] = useState<SavedMapViewState["viewport"]>(null);
  const graphShellRef = useRef<HTMLDivElement | null>(null);
  const pendingContextCameraRef = useRef<PendingContextCamera | null>(null);
  const pendingPrimaryFocusNodeIdRef = useRef<string | null>(null);
  const centeredSecondaryFocusKeyRef = useRef<string | null>(null);
  const appliedViewStateKeyRef = useRef<string | null>(null);
  const pendingSavedViewportRef = useRef<{ key: string; viewport: SavedMapViewState["viewport"] } | null>(null);
  const previousGraphAnalysisRef = useRef<AtlasGraph["analysis"] | null>(null);
  const skipNextFitViewRef = useRef(false);
  const skipNextContextResetRef = useRef(false);
  const selectionMarqueeRef = useRef<SelectionMarqueeGesture>({
    active: false,
    start: null,
    pointer: null
  });
  const selectionAutoPanFrameRef = useRef<number | null>(null);
  const pressureSimulationTimerRef = useRef<number[]>([]);
  const structuralSelectionActive = selectionToolActive && !runtimeState.active;
  const traceSignatureForIds = useCallback((edgeIds: string[]) => {
    return [...new Set(edgeIds)].sort().join("|");
  }, []);
  const laidOut = useMemo(
    () => (graph ? layoutStructuralContext(graph, currentContextId, pageIndex) : null),
    [currentContextId, graph, pageIndex]
  );
  const linkedCorridorLayouts = useMemo(
    () => graph
      ? linkedCorridors.map((corridor) => layoutStructuralContext(graph, corridor.contextId, corridor.pageIndex))
      : [],
    [graph, linkedCorridors]
  );
  const handleTraceStart = useCallback((edgeIds: string[], folderRelationCounts: Record<string, number> = {}) => {
    setTracedEdgeIds([...new Set(edgeIds)]);
    setTracedFolderRelationCounts(folderRelationCounts);
  }, []);
  const handleTraceEnd = useCallback(() => {
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
  }, []);
  const handleTraceToggle = useCallback((edgeIds: string[], folderRelationCounts: Record<string, number> = {}) => {
    if (!focusedNodeId) {
      return;
    }

    const nextIds = [...new Set(edgeIds)];
    const nextSignature = traceSignatureForIds(nextIds);
    const nextAnchor: PinnedTraceAnchor = {
      nodeId: focusedNodeId,
      corridorIndex: selectedCorridorIndex
    };
    const groupKey = `${nextAnchor.corridorIndex}:${nextAnchor.nodeId}:${nextSignature}`;

    setPinnedTraceGroups((current) => {
      if (current.some((group) => group.key === groupKey)) {
        return current.filter((group) => group.key !== groupKey);
      }

      return [
        ...current,
        {
          key: groupKey,
          edgeIds: nextIds,
          folderRelationCounts,
          anchor: nextAnchor
        }
      ];
    });
  }, [focusedNodeId, selectedCorridorIndex, traceSignatureForIds]);
  const handleRefactorRiskToggle = useCallback(() => {
    setRefactorRiskMode((active) => !active);
  }, []);
  const recordNodeFocus = useCallback((nodeId: string) => {
    setInteractionResidueByNodeId((current) => {
      const residue = current[nodeId] ?? { focusCount: 0, runtimeActivationCount: 0 };

      return {
        ...current,
        [nodeId]: {
          ...residue,
          focusCount: residue.focusCount + 1
        }
      };
    });
  }, []);
  const recordRuntimeActivation = useCallback((nodeId: string) => {
    setInteractionResidueByNodeId((current) => {
      const residue = current[nodeId] ?? { focusCount: 0, runtimeActivationCount: 0 };

      return {
        ...current,
        [nodeId]: {
          ...residue,
          runtimeActivationCount: residue.runtimeActivationCount + 1
        }
      };
    });
  }, []);

  const activeTraceEdgeIds = useMemo(
    () => [...new Set([...tracedEdgeIds, ...pinnedTraceGroups.flatMap((group) => group.edgeIds)])],
    [pinnedTraceGroups, tracedEdgeIds]
  );
  const activeTraceFolderRelationCounts = useMemo(
    () => mergeRelationCountMaps([
      ...pinnedTraceGroups.map((group) => group.folderRelationCounts),
      tracedFolderRelationCounts
    ]),
    [pinnedTraceGroups, tracedFolderRelationCounts]
  );

  const structuralState = useMemo<StructuralState | null>(() => {
    if (!laidOut) {
      return null;
    }

    return {
      currentContextId,
      focusedNodeId,
      tracedEdgeIds: activeTraceEdgeIds,
      pageIndex: laidOut.currentPage,
      breadcrumbPath: laidOut.breadcrumbPath.map((item) => item.id ?? "root"),
      clusteringMode
    };
  }, [activeTraceEdgeIds, clusteringMode, currentContextId, focusedNodeId, laidOut]);

  useEffect(() => {
    const previousAnalysis = previousGraphAnalysisRef.current;
    const nextAnalysis = graph?.analysis ?? null;
    const isProgressiveCompletion = Boolean(
      previousAnalysis?.pending &&
      previousAnalysis.jobId &&
      previousAnalysis.mode === "partial" &&
      nextAnalysis?.mode === "complete" &&
      nextAnalysis.jobId === previousAnalysis.jobId
    );
    previousGraphAnalysisRef.current = nextAnalysis;

    if (isProgressiveCompletion) {
      skipNextFitViewRef.current = true;
      return;
    }

    skipNextFitViewRef.current = false;
    setCurrentContextId(null);
    setFocusedNodeId(null);
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
    setPinnedTraceGroups([]);
    setSelectedRuntimeFileId(null);
    setSourceModalFile(null);
    setSourceModalInventoryMode(null);
    setMetadataForecastNodeId(null);
    setActivePressureInvestigation(null);
    setSelectedPressureFunctionId(null);
    setFilePanelView("metadata");
    setExpandedPanelRegion({ nodeId: null, region: null });
    setInteractionResidueByNodeId({});
    setTemporalIndex(0);
    setFocusedLandmarkId(null);
    setRefactorRiskMode(false);
    setRefactorRiskScanActive(false);
    setSelectedNode(null);
    setPressureAnalysisWindowOpen(false);
    setPageIndex(0);
    setLinkedCorridors([]);
    setCorridorLinks([]);
    setSelectedCorridorIndex(0);
    setManualNodePositions({});
    setRuntimeNodePositions({});
    setSelectedObjectIds([]);
    setRuntimeState(inactiveRuntimeState);
    setRuntimePlaybackActive(false);
    setViewportSnapshot(null);
    appliedViewStateKeyRef.current = null;
    pendingContextCameraRef.current = null;
    pendingPrimaryFocusNodeIdRef.current = null;
    centeredSecondaryFocusKeyRef.current = null;
  }, [graph]);

  useEffect(() => {
    if (skipNextContextResetRef.current) {
      skipNextContextResetRef.current = false;
      return;
    }

    setFocusedNodeId(null);
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
    setPinnedTraceGroups([]);
    setSelectedRuntimeFileId(null);
    setSourceModalFile(null);
    setSourceModalInventoryMode(null);
    setMetadataForecastNodeId(null);
    setActivePressureInvestigation(null);
    setSelectedPressureFunctionId(null);
    setFilePanelView("metadata");
    setExpandedPanelRegion({ nodeId: null, region: null });
    setSelectedNode(null);
    setPressureAnalysisWindowOpen(false);
    setPageIndex(0);
    setRuntimeNodePositions({});
    setSelectedObjectIds([]);
    setRuntimeState(inactiveRuntimeState);
    setRuntimePlaybackActive(false);
    pendingPrimaryFocusNodeIdRef.current = null;
    centeredSecondaryFocusKeyRef.current = null;
  }, [currentContextId]);

  useEffect(() => {
    setSelectedObjectIds([]);

    if (!selectionToolActive) {
      return;
    }

    setFocusedNodeId(null);
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
    setPinnedTraceGroups([]);
    setExpandedPanelRegion({ nodeId: null, region: null });
    setSelectedNode(null);
    setMetadataForecastNodeId(null);
    setFilePanelView("metadata");
  }, [selectionToolActive]);

  useEffect(() => {
    if (!structuralSelectionActive) {
      setSelectedObjectIds([]);
    }
  }, [structuralSelectionActive]);

  useEffect(() => {
    if (structuralSelectionActive) {
      return;
    }

    selectionMarqueeRef.current = { active: false, start: null, pointer: null };
    if (selectionAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionAutoPanFrameRef.current);
      selectionAutoPanFrameRef.current = null;
    }
  }, [structuralSelectionActive]);

  useEffect(() => () => {
    if (selectionAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionAutoPanFrameRef.current);
    }
  }, []);

  useEffect(() => {
    setRefactorRiskScanActive(refactorRiskMode);
  }, [refactorRiskMode]);

  useEffect(() => {
    if (!refactorRiskScanActive) {
      return;
    }

    const timer = window.setTimeout(() => setRefactorRiskScanActive(false), 840);
    return () => window.clearTimeout(timer);
  }, [refactorRiskScanActive]);

  useEffect(() => {
    if (!laidOut || pageIndex === laidOut.currentPage) {
      return;
    }

    setPageIndex(laidOut.currentPage);
  }, [laidOut, pageIndex]);

  useEffect(() => {
    if (!reactFlowInstance || !laidOut) {
      return;
    }

    if (skipNextFitViewRef.current) {
      skipNextFitViewRef.current = false;
      return;
    }

    window.requestAnimationFrame(() => {
      const pendingCamera = pendingContextCameraRef.current;

      if (pendingCamera && pendingCamera.contextId === currentContextId) {
        const corridorNodeIds = corridorFocusNodeIds(laidOut.nodes, pendingCamera.contextId);
        const corridorBounds = reactFlowInstance.getNodesBounds(corridorNodeIds);

        pendingContextCameraRef.current = null;
        if (corridorNodeIds.length > 0) {
          reactFlowInstance.setCenter(
            corridorBounds.x + corridorBounds.width / 2,
            corridorBounds.y + corridorBounds.height / 2,
            { zoom: pendingCamera.zoom, duration: 420 }
          );
          return;
        }
      }

      reactFlowInstance.fitView({ padding: 0.24, duration: 420 });
    });
  }, [currentContextId, laidOut, reactFlowInstance, runtimeState.active, runtimeState.currentStep, temporalIndex]);

  useEffect(() => {
    if (!runtimePlaybackActive || !runtimeState.active || !runtimeState.chain) {
      return;
    }

    const maxStep = Math.max(0, runtimeState.chain.nodes.length - 1);

    if (runtimeState.currentStep >= maxStep) {
      setRuntimePlaybackActive(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRuntimeState((current) => {
        if (!current.active || !current.chain) {
          return current;
        }

        return {
          ...current,
          currentStep: Math.min(current.currentStep + 1, Math.max(0, current.chain.nodes.length - 1))
        };
      });
    }, 720);

    return () => window.clearTimeout(timeoutId);
  }, [runtimePlaybackActive, runtimeState]);

  const commits = graph?.commits ?? [];
  const temporalStates = useMemo(() => (graph ? buildTemporalStates(graph, commits) : []), [commits, graph]);
  const temporalLandmarks = useMemo(
    () => extractArchitecturalLandmarks(commits, temporalStates),
    [commits, temporalStates]
  );
  const activeTemporalState = useMemo(() => temporalStates[temporalIndex] ?? null, [temporalIndex, temporalStates]);
  const activeTemporalDate = useMemo(() => {
    return activeTemporalState?.date ?? commits[0]?.date ?? new Date().toISOString();
  }, [activeTemporalState, commits]);
  const focusedLandmark = useMemo(() => {
    return temporalLandmarks.find((landmark) => landmark.id === focusedLandmarkId) ?? null;
  }, [focusedLandmarkId, temporalLandmarks]);
  const displayedLayoutNodes = useMemo(() => {
    if (!laidOut) {
      return [];
    }
    if (linkedCorridorLayouts.length === 0) {
      return laidOut.nodes;
    }

    const linkedLineageIds = new Set(
      linkedCorridorLayouts
        .flatMap((layout) => layout.nodes)
        .map(lineageKey)
        .filter((key): key is string => key !== null)
    );
    const baseNodes = laidOut.nodes.filter((node) => {
      const data = node.data as AtlasNode;
      return !(data.type === "folder" && !isLineageNode(node) && linkedLineageIds.has(flowNodeRealId(node)));
    });
    const renderedDuplicateKeys = new Set(baseNodes.map(duplicateKeyForNode).filter((key): key is string => key !== null));
    const corridorDrafts: CorridorPlacementDraft[] = [{
      corridorIndex: 0,
      nodes: baseNodes,
      bounds: layoutBounds(baseNodes),
      ...corridorMapPosition(0)
    }];

    for (const [index, layout] of linkedCorridorLayouts.entries()) {
      const corridorIndex = index + 1;
      const freshNodes = layout.nodes.filter((node) => {
        const data = node.data as AtlasNode;
        const duplicateKey = duplicateKeyForNode(node);

        return !(
          (data.type === "folder" && !isLineageNode(node) && linkedLineageIds.has(flowNodeRealId(node))) ||
          (duplicateKey && renderedDuplicateKeys.has(duplicateKey))
        );
      });

      for (const key of freshNodes.map(duplicateKeyForNode).filter((value): value is string => value !== null)) {
        renderedDuplicateKeys.add(key);
      }

      if (freshNodes.length > 0) {
        corridorDrafts.push({
          corridorIndex,
          nodes: freshNodes,
          bounds: layoutBounds(freshNodes),
          ...corridorMapPosition(corridorIndex)
        });
      }
    }

    const columnWidths = Array.from({ length: CORRIDOR_MAP_COLUMNS }, () => 0);
    const rowHeights: number[] = [];
    for (const draft of corridorDrafts) {
      columnWidths[draft.column] = Math.max(columnWidths[draft.column] ?? 0, draft.bounds.maxX - draft.bounds.minX);
      rowHeights[draft.row] = Math.max(rowHeights[draft.row] ?? 0, draft.bounds.maxY - draft.bounds.minY);
    }

    const baseBounds = corridorDrafts[0]?.bounds ?? layoutBounds(baseNodes);
    const columnLefts = Array.from({ length: CORRIDOR_MAP_COLUMNS }, () => baseBounds.minX);
    for (let column = 1; column < CORRIDOR_MAP_COLUMNS; column += 1) {
      columnLefts[column] = columnLefts[column - 1] + (columnWidths[column - 1] ?? 0) + SECONDARY_CORRIDOR_GAP_X;
    }

    const rowTops: number[] = [baseBounds.minY];
    for (let row = 1; row < rowHeights.length; row += 1) {
      rowTops[row] = rowTops[row - 1] + (rowHeights[row - 1] ?? 0) + CORRIDOR_MAP_ROW_GAP_Y;
    }

    const linkedNodes = corridorDrafts.slice(1).flatMap((draft) => {
      const xOffset = (columnLefts[draft.column] ?? baseBounds.minX) - draft.bounds.minX;
      const yOffset = (rowTops[draft.row] ?? baseBounds.minY) - draft.bounds.minY;

      return draft.nodes.map((node) => {
        const data = node.data as AtlasNode;

        return {
          ...node,
          id: corridorFlowId(draft.corridorIndex, node.id),
          position: {
            x: node.position.x + xOffset,
            y: node.position.y + yOffset
          },
          data: {
            ...data,
            realNodeId: node.id,
            corridor: "linked",
            corridorIndex: draft.corridorIndex
          }
        };
      });
    });

    return [...baseNodes, ...linkedNodes];
  }, [laidOut, linkedCorridorLayouts]);
  const visibleById = useMemo(() => {
    return new Map(displayedLayoutNodes.map((node) => [node.id, node.data as AtlasNode]));
  }, [displayedLayoutNodes]);
  const visibleFlowIdByRealId = useMemo(() => {
    const ids = new Map<string, string>();
    for (const node of displayedLayoutNodes) {
      const realId = flowNodeRealId(node);
      if (!ids.has(realId)) {
        ids.set(realId, node.id);
      }
    }

    return ids;
  }, [displayedLayoutNodes]);
  const graphNodeById = useMemo(() => {
    return new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  }, [graph]);
  const importedByCountById = useMemo(() => {
    const counts = new Map<string, number>();

    for (const edge of graph?.edges ?? []) {
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }

    return counts;
  }, [graph?.edges]);
  const refactorRiskByNodeId = useMemo(() => {
    const pressures = new Map<string, RefactorRiskPressure>();

    for (const node of graph?.nodes ?? []) {
      if (node.type === "file") {
        pressures.set(node.id, refactorRiskPressureFor(node, importedByCountById.get(node.id) ?? 0));
      }
    }

    return pressures;
  }, [graph?.nodes, importedByCountById]);
  const inspectSourceFromNodeMenu = useCallback((node: AtlasNode) => {
    if (node.type !== "file") {
      return;
    }

    recordNodeFocus(node.id);
    setFocusedNodeId(node.id);
    setSelectedNode(node);
    setMetadataForecastNodeId(null);
    setFilePanelView("metadata");
    setExpandedPanelRegion({ nodeId: node.id, region: null });
    setSourceModalInventoryMode(null);
    setSourceModalFile(node);
  }, [recordNodeFocus]);
  const showWiresFromNodeMenu = useCallback((node: AtlasNode) => {
    if (node.type !== "file") {
      return;
    }

    recordNodeFocus(node.id);
    setFocusedNodeId(node.id);
    setSelectedNode(node);
    setMetadataForecastNodeId(null);
    setFilePanelView("wires");
    setExpandedPanelRegion({ nodeId: node.id, region: null });
  }, [recordNodeFocus]);
  useEffect(() => {
    if (!graph || !initialViewState || !viewStateKey || appliedViewStateKeyRef.current === viewStateKey) {
      return;
    }

    const hasNode = (nodeId: string | null | undefined): nodeId is string =>
      typeof nodeId === "string" && graphNodeById.has(nodeId);
    const isValidContext = (nodeId: string | null): boolean =>
      nodeId === null || graphNodeById.get(nodeId)?.type === "folder";
    const numericPositionMap = (positions: SavedMapViewState["manualNodePositions"]): ManualNodePositions => {
      const nextPositions: ManualNodePositions = {};

      for (const [nodeId, position] of Object.entries(positions ?? {})) {
        if (
          typeof position?.x === "number" &&
          Number.isFinite(position.x) &&
          typeof position.y === "number" &&
          Number.isFinite(position.y)
        ) {
          nextPositions[nodeId] = { x: position.x, y: position.y };
        }
      }

      return nextPositions;
    };

    const selectedNodeId = hasNode(initialViewState.selectedNodeId)
      ? initialViewState.selectedNodeId
      : hasNode(initialViewState.focusedNodeId)
        ? initialViewState.focusedNodeId
        : null;
    const focusedNodeIdFromState = hasNode(initialViewState.focusedNodeId) ? initialViewState.focusedNodeId : null;
    const forecastNodeId =
      hasNode(initialViewState.metadataForecastNodeId) &&
      graphNodeById.get(initialViewState.metadataForecastNodeId)?.type === "file"
        ? initialViewState.metadataForecastNodeId
        : null;
    const linkedCorridorsFromState = (initialViewState.linkedCorridors ?? [])
      .filter((corridor) => hasNode(corridor.focusedNodeId) && isValidContext(corridor.contextId))
      .map((corridor) => ({
        contextId: corridor.contextId,
        focusedNodeId: corridor.focusedNodeId,
        pageIndex: Number.isInteger(corridor.pageIndex) ? Math.max(0, corridor.pageIndex) : 0
      }));
    const corridorLinksFromState = (initialViewState.corridorLinks ?? [])
      .filter((link) => (
        hasNode(link.originNodeId) &&
        hasNode(link.targetNodeId) &&
        (link.direction === "imports" || link.direction === "imported-by")
      ))
      .map((link) => ({
        originCorridorIndex: Math.max(0, Number(link.originCorridorIndex) || 0),
        originNodeId: link.originNodeId,
        targetCorridorIndex: Math.max(0, Number(link.targetCorridorIndex) || 0),
        targetNodeId: link.targetNodeId,
        direction: link.direction,
        subdued: link.subdued === true
      }));
    const pinnedTraceGroupsFromState = (initialViewState.pinnedTraceGroups ?? [])
      .filter((group) => hasNode(group.anchor?.nodeId) && Array.isArray(group.edgeIds))
      .map((group) => ({
        key: group.key,
        edgeIds: [...new Set(group.edgeIds.filter((edgeId) => typeof edgeId === "string"))],
        folderRelationCounts: Object.fromEntries(
          Object.entries(group.folderRelationCounts ?? {})
            .filter(([, count]) => typeof count === "number" && Number.isFinite(count))
        ),
        anchor: {
          nodeId: group.anchor.nodeId,
          corridorIndex: Math.max(0, Number(group.anchor.corridorIndex) || 0)
        }
      }))
      .filter((group) => group.edgeIds.length > 0);

    const nextContextId = isValidContext(initialViewState.currentContextId) ? initialViewState.currentContextId : null;
    skipNextContextResetRef.current = nextContextId !== currentContextId;
    setCurrentContextId(nextContextId);
    setPageIndex(Number.isInteger(initialViewState.pageIndex) ? Math.max(0, initialViewState.pageIndex) : 0);
    setFocusedNodeId(focusedNodeIdFromState);
    setSelectedNode(selectedNodeId ? graphNodeById.get(selectedNodeId) ?? null : null);
    setFilePanelView(initialViewState.filePanelView === "wires" ? "wires" : "metadata");
    setMetadataForecastNodeId(forecastNodeId);
    setSelectedCorridorIndex(Math.max(0, Number(initialViewState.selectedCorridorIndex) || 0));
    setLinkedCorridors(linkedCorridorsFromState);
    setCorridorLinks(corridorLinksFromState);
    setPinnedTraceGroups(pinnedTraceGroupsFromState);
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
    setManualNodePositions(numericPositionMap(initialViewState.manualNodePositions));
    setRuntimeNodePositions({});
    setSelectedObjectIds([]);
    setRuntimeState(inactiveRuntimeState);
    setRuntimePlaybackActive(false);
    pendingSavedViewportRef.current = {
      key: viewStateKey,
      viewport: initialViewState.viewport
    };
    appliedViewStateKeyRef.current = viewStateKey;
  }, [currentContextId, graph, graphNodeById, initialViewState, viewStateKey]);
  const collapsedFileSectionSet = useMemo(() => new Set(collapsedFileSections), [collapsedFileSections]);
  const collapsedFileConnectionSectionSet = useMemo(
    () => new Set(collapsedFileConnectionSections),
    [collapsedFileConnectionSections]
  );
  const toggleFileMetadataSection = useCallback((sectionId: FileMetadataSectionId) => {
    setCollapsedFileSections((current) => (
      current.includes(sectionId)
        ? current.filter((candidate) => candidate !== sectionId)
        : [...current, sectionId]
    ));
  }, []);
  const toggleFileConnectionSection = useCallback((sectionId: RelationshipFollowDirection) => {
    setCollapsedFileConnectionSections((current) => (
      current.includes(sectionId)
        ? current.filter((candidate) => candidate !== sectionId)
        : [...current, sectionId]
    ));
  }, []);
  const runtimeLayout = useMemo(() => {
    if (!graph || !runtimeState.active || !runtimeState.chain) {
      return null;
    }

    return layoutRuntimeCorridor(graph, displayedLayoutNodes, runtimeState.chain, runtimeState.currentStep);
  }, [displayedLayoutNodes, graph, runtimeState]);
  const selectedObjectIdSet = useMemo(() => new Set(selectedObjectIds), [selectedObjectIds]);
  const handleSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: AtlasFlowNode[] }) => {
    if (!structuralSelectionActive) {
      return;
    }

    setSelectedObjectIds(
      selectedNodes
        .filter((node) => node.selectable !== false)
        .map((node) => node.id)
    );
  }, [structuralSelectionActive]);
  const stopSelectionAutoPan = useCallback(() => {
    if (selectionAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionAutoPanFrameRef.current);
      selectionAutoPanFrameRef.current = null;
    }
  }, []);
  const updateMarqueeSelection = useCallback(() => {
    const gesture = selectionMarqueeRef.current;

    if (!gesture.active || !gesture.start || !gesture.pointer || !reactFlowInstance) {
      return;
    }

    const marquee = {
      left: Math.min(gesture.start.x, gesture.pointer.x),
      right: Math.max(gesture.start.x, gesture.pointer.x),
      top: Math.min(gesture.start.y, gesture.pointer.y),
      bottom: Math.max(gesture.start.y, gesture.pointer.y)
    };
    const selectedIds = reactFlowInstance.getNodes()
      .filter((node) => node.selectable !== false)
      .filter((node) => {
        const bounds = reactFlowInstance.getNodesBounds([node]);
        const topLeft = reactFlowInstance.flowToScreenPosition({ x: bounds.x, y: bounds.y });
        const bottomRight = reactFlowInstance.flowToScreenPosition({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height
        });

        return (
          topLeft.x <= marquee.right &&
          bottomRight.x >= marquee.left &&
          topLeft.y <= marquee.bottom &&
          bottomRight.y >= marquee.top
        );
      })
      .map((node) => node.id);

    setSelectedObjectIds((currentIds) => {
      if (currentIds.length === selectedIds.length && currentIds.every((id) => selectedIds.includes(id))) {
        return currentIds;
      }

      return selectedIds;
    });
  }, [reactFlowInstance]);
  const beginSelectionAutoPan = useCallback(() => {
    if (selectionAutoPanFrameRef.current !== null) {
      return;
    }

    const panFrame = () => {
      selectionAutoPanFrameRef.current = null;
      const gesture = selectionMarqueeRef.current;
      const shellBounds = graphShellRef.current?.getBoundingClientRect();

      if (!gesture.active || !gesture.pointer || !shellBounds || !reactFlowInstance) {
        return;
      }

      const distanceFromLeft = gesture.pointer.x - shellBounds.left;
      const distanceFromRight = shellBounds.right - gesture.pointer.x;
      const distanceFromTop = gesture.pointer.y - shellBounds.top;
      const distanceFromBottom = shellBounds.bottom - gesture.pointer.y;
      const panMagnitude = (distance: number): number => {
        if (distance >= SELECTION_AUTOPAN_EDGE_DISTANCE) {
          return 0;
        }

        return Math.min(
          SELECTION_AUTOPAN_MAX_STEP,
          ((SELECTION_AUTOPAN_EDGE_DISTANCE - distance) / SELECTION_AUTOPAN_EDGE_DISTANCE) * SELECTION_AUTOPAN_MAX_STEP
        );
      };
      const xDelta = panMagnitude(distanceFromLeft) - panMagnitude(distanceFromRight);
      const yDelta = panMagnitude(distanceFromTop) - panMagnitude(distanceFromBottom);

      if (xDelta !== 0 || yDelta !== 0) {
        const viewport = reactFlowInstance.getViewport();

        void reactFlowInstance.setViewport({
          x: viewport.x + xDelta,
          y: viewport.y + yDelta,
          zoom: viewport.zoom
        }).then(updateMarqueeSelection);
      }

      selectionAutoPanFrameRef.current = window.requestAnimationFrame(panFrame);
    };

    selectionAutoPanFrameRef.current = window.requestAnimationFrame(panFrame);
  }, [reactFlowInstance, updateMarqueeSelection]);
  const handleSelectionPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;

    if (
      !structuralSelectionActive ||
      event.button !== 0 ||
      !event.isPrimary ||
      !(target instanceof Element) ||
      !target.classList.contains("react-flow__pane")
    ) {
      return;
    }

    selectionMarqueeRef.current = {
      active: false,
      start: { x: event.clientX, y: event.clientY },
      pointer: { x: event.clientX, y: event.clientY }
    };
  }, [structuralSelectionActive]);
  const handleSelectionPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!structuralSelectionActive || !selectionMarqueeRef.current.start) {
      return;
    }

    selectionMarqueeRef.current.pointer = { x: event.clientX, y: event.clientY };
    if (selectionMarqueeRef.current.active) {
      updateMarqueeSelection();
    }
  }, [structuralSelectionActive, updateMarqueeSelection]);
  const handleSelectionStart = useCallback((event: ReactMouseEvent) => {
    if (!structuralSelectionActive) {
      return;
    }

    const gesture = selectionMarqueeRef.current;
    selectionMarqueeRef.current = {
      active: true,
      start: gesture.start ?? { x: event.clientX, y: event.clientY },
      pointer: { x: event.clientX, y: event.clientY }
    };
    beginSelectionAutoPan();
  }, [beginSelectionAutoPan, structuralSelectionActive]);
  const handleSelectionEnd = useCallback(() => {
    selectionMarqueeRef.current = { active: false, start: null, pointer: null };
    stopSelectionAutoPan();
  }, [stopSelectionAutoPan]);
  const handleNodesChange = useCallback((changes: NodeChange<AtlasFlowNode>[]) => {
    if (runtimeState.active && runtimeLayout) {
      setRuntimeNodePositions((currentPositions) => {
        let nextPositions = currentPositions;

        for (const change of changes) {
          if (change.type === "position" && change.position && runtimeLayout.revealedNodeIds.has(change.id)) {
            if (nextPositions === currentPositions) {
              nextPositions = { ...currentPositions };
            }

            nextPositions[change.id] = change.position;
          }

          if (change.type === "remove" && nextPositions[change.id]) {
            if (nextPositions === currentPositions) {
              nextPositions = { ...currentPositions };
            }

            delete nextPositions[change.id];
          }
        }

        return nextPositions;
      });
      return;
    }

    setManualNodePositions((currentPositions) => {
      let nextPositions = currentPositions;

      for (const change of changes) {
        if (change.type === "position" && change.position) {
          if (nextPositions === currentPositions) {
            nextPositions = { ...currentPositions };
          }

          nextPositions[change.id] = change.position;
        }

        if (change.type === "remove" && nextPositions[change.id]) {
          if (nextPositions === currentPositions) {
            nextPositions = { ...currentPositions };
          }

          delete nextPositions[change.id];
        }
      }

      return nextPositions;
    });
  }, [runtimeLayout, runtimeState.active]);
  const activeNodeId = focusedNodeId;
  const relationshipCollection = useMemo(() => {
    if (!graph || !laidOut || !activeNodeId || runtimeState.active) {
      return null;
    }

    return collectRelationships(
      graph.edges,
      graphNodeById,
      displayedLayoutNodes,
      activeNodeId,
      selectedCorridorIndex
    );
  }, [activeNodeId, displayedLayoutNodes, graph, graphNodeById, laidOut, runtimeState.active, selectedCorridorIndex]);
  const relationshipBudget = useMemo(
    () => relationshipCollection ? budgetRelationships(relationshipCollection, 6) : null,
    [relationshipCollection]
  );
  const relationshipTrace = useMemo(
    () => relationshipCollection ? traceRelationships(relationshipCollection) : null,
    [relationshipCollection]
  );
  const connectionPortsByNodeId = useMemo(() => {
    const ports = new Map<string, { input: boolean; export: boolean }>();

    if (!laidOut) {
      return ports;
    }

    const markConnection = (sourceId: string, targetId: string) => {
      const sourcePorts = ports.get(sourceId) ?? { input: false, export: false };
      const targetPorts = ports.get(targetId) ?? { input: false, export: false };

      ports.set(sourceId, { ...sourcePorts, export: true });
      ports.set(targetId, { ...targetPorts, input: true });
    };
    const connectionEdges =
      runtimeState.active && runtimeLayout
        ? [...laidOut.lineageEdges, ...runtimeLayout.edges]
        : [...laidOut.lineageEdges, ...laidOut.edges];

    for (const edge of connectionEdges) {
      markConnection(edge.source, edge.target);
    }

    return ports;
  }, [laidOut, runtimeLayout, runtimeState.active]);

  const nodes = useMemo<AtlasFlowNode[]>(() => {
    if (!laidOut) {
      return [];
    }
    const activeFolderRelationCounts = activeTraceFolderRelationCounts;

    const baseNodes = displayedLayoutNodes.map((node) => {
      const data = node.data as AtlasNode;
      const realNodeId = flowNodeRealId(node);
      const isLineageAnchor = typeof data.lineageKind === "string";
      const isOriginCorridorSpine = Number(data.corridorIndex ?? 0) === 0 && isLineageAnchor;
      const temporalPressure = nodeTemporalPressure(data, activeTemporalState);
      const isActive = activeNodeId === realNodeId;
      const visualState = composeNodeVisualState({
        isFocused: isActive
      });
      const resolvedVisualState = visualState;
      const shouldShowStubs = !runtimeState.active && focusedNodeId === realNodeId;
      const outgoingCount = shouldShowStubs ? relationshipBudget?.totalOutgoing ?? 0 : 0;
      const incomingCount = shouldShowStubs ? relationshipBudget?.totalIncoming ?? 0 : 0;
      const outgoingRelationships = shouldShowStubs
        ? relationshipTrace?.outgoing ?? []
        : [];
      const incomingRelationships = shouldShowStubs
        ? relationshipTrace?.incoming ?? []
        : [];
      const outgoingEdgeIds = outgoingRelationships.map((relation) => relation.edge.id);
      const incomingEdgeIds = incomingRelationships.map((relation) => relation.edge.id);
      const outgoingFolderRelationCounts = folderTraceCountsForRelationships(outgoingRelationships);
      const incomingFolderRelationCounts = folderTraceCountsForRelationships(incomingRelationships);
      const relationTraceCount =
        data.type === "folder"
          ? activeFolderRelationCounts[realNodeId] ?? activeFolderRelationCounts[node.id] ?? 0
          : 0;
      const resolvedPosition =
        runtimeState.active && runtimeLayout?.revealedNodeIds.has(node.id)
          ? runtimeNodePositions[node.id] ?? runtimeLayout.positions.get(node.id) ?? node.position
          : manualNodePositions[node.id] ?? node.position;
      const refactorRisk = data.type === "file" ? refactorRiskByNodeId.get(realNodeId) : undefined;
      const pressureSimulationClass = pressureSimulation
        ? realNodeId === pressureSimulation.nodeId
          ? "pressure-simulation-focus"
          : "pressure-simulation-dim"
        : "";

      return {
        ...node,
        position: resolvedPosition,
        draggable: runtimeState.active
          ? Boolean(runtimeLayout?.revealedNodeIds.has(node.id))
          : !isOriginCorridorSpine,
        selectable: structuralSelectionActive && !isOriginCorridorSpine,
        selected: structuralSelectionActive && !isOriginCorridorSpine && selectedObjectIdSet.has(node.id),
        zIndex: resolvedVisualState.zIndex,
        style: visualStateStyle(resolvedVisualState),
        data: {
          ...data,
          historyBadge: historyBadgeFor(data, graph?.fileHistory),
          temporalPressure,
          visualState: resolvedVisualState,
          connectionPorts: connectionPortsByNodeId.get(node.id) ?? connectionPortsByNodeId.get(realNodeId),
          runtimeStep: runtimeState.active ? runtimeState.chain?.nodes.find((runtimeNode) => runtimeNode.id === node.id)?.runtimeStep : undefined,
          relationTraceCount: relationTraceCount > 0 ? relationTraceCount : undefined,
          importedByCount: data.type === "file" ? importedByCountById.get(realNodeId) ?? 0 : undefined,
          onInspectSource: data.type === "file" ? inspectSourceFromNodeMenu : undefined,
          onShowWires: data.type === "file" ? showWiresFromNodeMenu : undefined,
          refactorRiskLabel: refactorRisk?.label,
          refactorRiskReasons: refactorRisk?.reasons,
          relationStub:
            shouldShowStubs && (outgoingCount > 0 || incomingCount > 0)
              ? {
                  incomingCount,
                  outgoingCount,
                  incomingEdgeIds,
                  outgoingEdgeIds,
                  incomingFolderRelationCounts,
                  outgoingFolderRelationCounts,
                  onTraceStart: handleTraceStart,
                  onTraceToggle: handleTraceToggle,
                  onTraceEnd: handleTraceEnd
                }
              : undefined
        },
        className: [resolvedVisualState.className, pressureSimulationClass].filter(Boolean).join(" ")
      };
    });

    if (!runtimeLayout || !runtimeState.active) {
      return baseNodes;
    }

    const runtimeExtraNodes = runtimeLayout.extraNodes.map((node) => {
      const data = node.data as AtlasNode;
      const visualState = composeNodeVisualState({
        isFocused: false
      });
      const resolvedPosition = runtimeNodePositions[node.id] ?? node.position;
      const refactorRisk = data.type === "file" ? refactorRiskByNodeId.get(flowNodeRealId(node)) : undefined;

      return {
        ...node,
        position: resolvedPosition,
        draggable: true,
        selectable: false,
        selected: false,
        zIndex: visualState.zIndex,
        style: visualStateStyle(visualState),
        data: {
          ...data,
          historyBadge: historyBadgeFor(data, graph?.fileHistory),
          visualState,
          connectionPorts: connectionPortsByNodeId.get(node.id),
          importedByCount: data.type === "file" ? importedByCountById.get(flowNodeRealId(node)) ?? 0 : undefined,
          onInspectSource: data.type === "file" ? inspectSourceFromNodeMenu : undefined,
          onShowWires: data.type === "file" ? showWiresFromNodeMenu : undefined,
          refactorRiskLabel: refactorRisk?.label,
          refactorRiskReasons: refactorRisk?.reasons
        },
        className: `${visualState.className} runtime-node`
      };
    });

    return [...baseNodes, ...runtimeExtraNodes];
  }, [
    activeNodeId,
    connectionPortsByNodeId,
    handleTraceEnd,
    handleTraceStart,
    handleTraceToggle,
    importedByCountById,
    inspectSourceFromNodeMenu,
    displayedLayoutNodes,
    laidOut,
    manualNodePositions,
    relationshipBudget,
    relationshipTrace,
    activeTraceFolderRelationCounts,
    focusedNodeId,
    activeTemporalState,
    pressureSimulation,
    graph?.fileHistory,
    refactorRiskByNodeId,
    runtimeLayout,
    runtimeNodePositions,
    runtimeState,
    selectedObjectIdSet,
    showWiresFromNodeMenu,
    structuralSelectionActive
  ]);

  useEffect(() => {
    const pendingSavedViewport = pendingSavedViewportRef.current;

    if (!pendingSavedViewport || !reactFlowInstance || nodes.length === 0) {
      return;
    }

    pendingSavedViewportRef.current = null;
    const savedViewport = pendingSavedViewport.viewport;
    if (!savedViewport) {
      return;
    }

    window.requestAnimationFrame(() => {
      void reactFlowInstance.setViewport(savedViewport, { duration: 320 });
      setViewportSnapshot(savedViewport);
    });
  }, [nodes, reactFlowInstance]);

  useEffect(() => {
    const pendingPrimaryFocusNodeId = pendingPrimaryFocusNodeIdRef.current;
    if (pendingPrimaryFocusNodeId && reactFlowInstance) {
      const flowNode = nodes.find((candidate) => (
        flowNodeRealId(candidate) === pendingPrimaryFocusNodeId &&
        (candidate.data as AtlasNode).corridor !== "secondary"
      ));

      if (flowNode) {
        pendingPrimaryFocusNodeIdRef.current = null;
        window.requestAnimationFrame(() => {
          const bounds = reactFlowInstance.getNodesBounds([flowNode]);
          void reactFlowInstance.setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
            zoom: Math.max(reactFlowInstance.getViewport().zoom, 1.1),
            duration: 420
          });
        });
      }
    }

    const latestCorridorIndex = linkedCorridors.length;
    const latestCorridor = linkedCorridors[latestCorridorIndex - 1];
    if (!latestCorridor || !reactFlowInstance) {
      return;
    }

    const secondaryFocusKey = `${latestCorridorIndex}:${latestCorridor.contextId ?? "root"}:${latestCorridor.focusedNodeId}:${latestCorridor.pageIndex}`;
    if (centeredSecondaryFocusKeyRef.current === secondaryFocusKey) {
      return;
    }

    window.requestAnimationFrame(() => {
      const flowNode = nodes.find((candidate) => candidate.id === corridorFlowId(latestCorridorIndex, latestCorridor.focusedNodeId));
      if (!flowNode) {
        return;
      }

      centeredSecondaryFocusKeyRef.current = secondaryFocusKey;
      const bounds = reactFlowInstance.getNodesBounds([flowNode]);
      void reactFlowInstance.setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
        zoom: Math.max(reactFlowInstance.getViewport().zoom, 1.05),
        duration: 420
      });
    });
  }, [linkedCorridors, nodes, reactFlowInstance]);

  const edges = useMemo(() => {
    if (!laidOut) {
      return [];
    }

    const visibleFlowNodeIds = new Set(displayedLayoutNodes.map((node) => node.id));
    const primaryLineageEdges = laidOut.lineageEdges.filter((edge) => (
      visibleFlowNodeIds.has(edge.source) && visibleFlowNodeIds.has(edge.target)
    ));
    const linkedLineageEdges = linkedCorridorLayouts.flatMap((layout, index) => {
      const corridorIndex = index + 1;
      return layout.lineageEdges
        .map((edge) => remapCorridorLineageEdge(edge, corridorIndex, visibleFlowIdByRealId))
        .filter((edge): edge is AtlasFlowEdge => edge !== null);
    });
    const crossCorridorEdges: AtlasFlowEdge[] = corridorLinks.map((link, index) => {
      const isImportedBy = link.direction === "imported-by";
      const sourceNodeId = isImportedBy ? link.targetNodeId : link.originNodeId;
      const sourceCorridorIndex = isImportedBy ? link.targetCorridorIndex : link.originCorridorIndex;
      const targetNodeId = isImportedBy ? link.originNodeId : link.targetNodeId;
      const targetCorridorIndex = isImportedBy ? link.originCorridorIndex : link.targetCorridorIndex;

      return {
        id: `corridor-link:${index + 1}:${sourceCorridorIndex}:${sourceNodeId}->${targetCorridorIndex}:${targetNodeId}`,
        source: visibleFlowIdByRealId.get(sourceNodeId) ?? corridorFlowId(sourceCorridorIndex, sourceNodeId),
        target: visibleFlowIdByRealId.get(targetNodeId) ?? corridorFlowId(targetCorridorIndex, targetNodeId),
        type: "structural",
        animated: false,
        zIndex: 2,
        data: {
          kind: "corridor-link",
          direction: isImportedBy ? "incoming" : "outgoing",
          mode: "focus",
          corridor: "bridge",
          subdued: link.subdued === true
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: RELATIONSHIP_BRIDGE_COLORS[link.direction]
        }
      };
    });
    const baseEdges = [...primaryLineageEdges, ...linkedLineageEdges, ...crossCorridorEdges];
    if (runtimeState.active && runtimeLayout) {
      return [...baseEdges, ...runtimeLayout.edges];
    }

    const traceRenderItems = [
      ...(activeNodeId
        ? tracedEdgeIds.map((edgeId) => ({
            edgeId,
            isPinnedTrace: false,
            anchor: { nodeId: activeNodeId, corridorIndex: selectedCorridorIndex },
            renderKey: `hover:${edgeId}`
          }))
        : []),
      ...pinnedTraceGroups.flatMap((group) => (
        group.edgeIds.map((edgeId) => ({
          edgeId,
          isPinnedTrace: true,
          anchor: group.anchor,
          renderKey: `${group.key}:${edgeId}`
        }))
      ))
    ];

    if (traceRenderItems.length === 0) {
      return baseEdges;
    }

    const visibleFlowNodeById = new Map(displayedLayoutNodes.map((node) => [node.id, node]));
    const activeTraceEdges: AtlasFlowEdge[] = traceRenderItems.flatMap((traceItem): AtlasFlowEdge[] => {
      const tracedEdgeId = traceItem.edgeId;
      const isPinnedTrace = traceItem.isPinnedTrace;
      const traceAnchor = traceItem.anchor;
      const traceAnchorNode = graphNodeById.get(traceAnchor.nodeId) ?? null;
      const parsedRelationshipEdge = parseRelationshipEdgeId(tracedEdgeId);
      if (parsedRelationshipEdge) {
        const sourceNode = visibleFlowNodeById.get(parsedRelationshipEdge.source);
        const targetNode = visibleFlowNodeById.get(parsedRelationshipEdge.target);

        if (!sourceNode || !targetNode || sourceNode.id === targetNode.id || !traceAnchorNode) {
          return [];
        }

        const sourceData = sourceNode.data as AtlasNode;
        const targetData = targetNode.data as AtlasNode;
        const sourceIsActive = ownsPath(traceAnchorNode, sourceData.path);
        const targetIsActive = ownsPath(traceAnchorNode, targetData.path);

        if (sourceIsActive === targetIsActive) {
          return [];
        }

        const isOutgoing = sourceIsActive;
        return [{
          id: `metadata-trace:${traceItem.renderKey}`,
          source: parsedRelationshipEdge.source,
          target: parsedRelationshipEdge.target,
          type: "structural" as const,
          animated: false,
          className: undefined,
          zIndex: isPinnedTrace ? 2 : 1,
          data: {
            kind: isPinnedTrace ? "corridor-link" : "context-import",
            direction: isOutgoing ? "outgoing" : "incoming",
            laneOffset: 0,
            mode: "focus",
            exactTrace: true,
            corridor: isPinnedTrace ? "bridge" : undefined,
            subdued: false
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isOutgoing ? "#2dd4bf" : "#facc15"
          }
        }];
      }

      const primaryTraceEdge = laidOut.edges.find((edge) => edge.id === tracedEdgeId);
      const linkedTraceMatch = linkedCorridorLayouts
        .map((layout, index) => ({ edge: layout.edges.find((edge) => edge.id === tracedEdgeId), corridorIndex: index + 1 }))
        .find((match) => match.edge);
      const tracedEdge = primaryTraceEdge ?? linkedTraceMatch?.edge;
      const graphTraceEdge = graph?.edges.find((edge) => edge.id === tracedEdgeId);
      if (graphTraceEdge) {
        if (graphTraceEdge.source !== traceAnchor.nodeId && graphTraceEdge.target !== traceAnchor.nodeId) {
          return [];
        }

        const source = visibleOwnerForEndpoint(
          graphTraceEdge.source,
          graphNodeById,
          displayedLayoutNodes,
          traceAnchor.corridorIndex
        )?.id ?? visibleFlowEndpointForPath(graphTraceEdge.source, displayedLayoutNodes, visibleFlowIdByRealId);
        const target = visibleOwnerForEndpoint(
          graphTraceEdge.target,
          graphNodeById,
          displayedLayoutNodes,
          traceAnchor.corridorIndex
        )?.id ?? visibleFlowEndpointForPath(graphTraceEdge.target, displayedLayoutNodes, visibleFlowIdByRealId);
        if (!source || !target || source === target) {
          return [];
        }

        const isOutgoing = graphTraceEdge.source === traceAnchor.nodeId;
        return [{
          id: `metadata-trace:${traceItem.renderKey}`,
          source,
          target,
          type: "structural" as const,
          animated: false,
          className: undefined,
          zIndex: isPinnedTrace ? 2 : 1,
          data: {
            kind: isPinnedTrace ? "corridor-link" : "context-import",
            direction: isOutgoing ? "outgoing" : "incoming",
            laneOffset: 0,
            mode: "focus",
            exactTrace: true,
            corridor: isPinnedTrace ? "bridge" : undefined,
            subdued: false
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isOutgoing ? "#2dd4bf" : "#facc15"
          }
        }];
      }

      if (!tracedEdge || (tracedEdge.source !== traceAnchor.nodeId && tracedEdge.target !== traceAnchor.nodeId)) {
        return [];
      }

      const isOutgoing = tracedEdge.source === traceAnchor.nodeId;
      const renderedTraceEdge = linkedTraceMatch?.edge ? remapCorridorEdge(tracedEdge, linkedTraceMatch.corridorIndex) : tracedEdge;
      return [{
        ...renderedTraceEdge,
        id: `metadata-trace:${traceItem.renderKey}`,
        animated: false,
        className: undefined,
        zIndex: isPinnedTrace ? 2 : renderedTraceEdge.zIndex ?? 1,
        data: {
          ...renderedTraceEdge.data,
          direction: isOutgoing ? "outgoing" : "incoming",
          laneOffset: 0,
          mode: "focus",
          exactTrace: true,
          kind: isPinnedTrace ? "corridor-link" : renderedTraceEdge.data?.kind,
          corridor: isPinnedTrace ? "bridge" : renderedTraceEdge.data?.corridor,
          subdued: false
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isOutgoing ? "#2dd4bf" : "#facc15"
        }
      }];
    });

    return [
      ...baseEdges,
      ...activeTraceEdges
    ];
  }, [activeNodeId, corridorLinks, displayedLayoutNodes, graph?.edges, graphNodeById, laidOut, linkedCorridorLayouts, pinnedTraceGroups, runtimeLayout, runtimeState.active, selectedCorridorIndex, tracedEdgeIds, visibleFlowIdByRealId]);

  useEffect(() => {
    if (!onViewStateChange) {
      return;
    }

    if (!graph || !laidOut) {
      onViewStateChange(null);
      return;
    }

    onViewStateChange({
      version: 1,
      currentContextId,
      pageIndex: laidOut.currentPage,
      focusedNodeId,
      selectedNodeId: selectedNode?.id ?? null,
      filePanelView,
      metadataForecastNodeId,
      selectedCorridorIndex,
      clusteringMode,
      linkedCorridors,
      corridorLinks,
      pinnedTraceGroups,
      manualNodePositions,
      viewport: viewportSnapshot ?? reactFlowInstance?.getViewport() ?? null,
      visibleNodeIds: [...new Set(displayedLayoutNodes.map(flowNodeRealId))],
      visibleFlowNodeIds: displayedLayoutNodes.map((node) => node.id),
      visibleEdgeIds: edges.map((edge) => edge.id),
      activeTraceEdgeIds
    });
  }, [
    activeTraceEdgeIds,
    clusteringMode,
    corridorLinks,
    currentContextId,
    displayedLayoutNodes,
    edges,
    filePanelView,
    focusedNodeId,
    graph,
    laidOut,
    linkedCorridors,
    manualNodePositions,
    metadataForecastNodeId,
    onViewStateChange,
    pageIndex,
    pinnedTraceGroups,
    reactFlowInstance,
    selectedCorridorIndex,
    selectedNode?.id,
    viewportSnapshot
  ]);

  function renderRelationTrace(edgeId: string): {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  } {
    return {
      onMouseEnter: () => {
        setTracedEdgeIds([edgeId]);
        setTracedFolderRelationCounts({});
      },
      onMouseLeave: () => {
        setTracedEdgeIds([]);
        setTracedFolderRelationCounts({});
      }
    };
  }

  function relationDirectionForEdge(edgeId: string, nodeId: string): "incoming" | "outgoing" {
    const edge = laidOut?.edges.find((candidate) => candidate.id === edgeId);
    return edge?.source === nodeId ? "outgoing" : "incoming";
  }

  function edgeMarkerColor(edgeId: string, nodeId: string): string {
    return relationDirectionForEdge(edgeId, nodeId) === "outgoing" ? "#2dd4bf" : "#facc15";
  }

  const relationLens = useMemo(() => {
    if (!graph || !laidOut || !selectedNode) {
      return null;
    }

    const collection = collectRelationships(
      graph.edges,
      graphNodeById,
      displayedLayoutNodes,
      selectedNode.id,
      selectedCorridorIndex
    );
    const budget = budgetRelationships(collection, 6);
    const visibleOutgoing = budget.visible
      .filter((relation) => relation.direction === "outgoing")
      .map((relation) => ({
        id: relation.edge.id,
        label: relation.otherNode?.label ?? relation.edge.target,
        count: relation.count
      }));
    const visibleIncoming = budget.visible
      .filter((relation) => relation.direction === "incoming")
      .map((relation) => ({
        id: relation.edge.id,
        label: relation.otherNode?.label ?? relation.edge.source,
        count: relation.count
      }));
    return {
      visibleOutgoing,
      visibleIncoming,
      hiddenVisibleOutgoing: budget.hiddenOutgoing,
      hiddenVisibleIncoming: budget.hiddenIncoming
    };
  }, [displayedLayoutNodes, graph, graphNodeById, laidOut, selectedCorridorIndex, selectedNode]);

  const importedByCount = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type !== "file") {
      return 0;
    }

    return graph.edges.filter((edge) => edge.target === selectedNode.id).length;
  }, [graph, selectedNode]);
  const selectedFileForecast = useMemo(
    () => selectedNode?.type === "file"
      ? buildFileForecast(selectedNode, { importedByCount })
      : null,
    [importedByCount, selectedNode]
  );
  const forecastInspectionMode: ForecastInspectionMode = refactorRiskMode ? "simulation" : "weather";
  const metadataForecastActive =
    Boolean(selectedFileForecast?.available && selectedNode && metadataForecastNodeId === selectedNode.id);
  const selectedFileWeatherForecast = useMemo(
    () => selectedNode?.type === "file" && selectedFileForecast?.available
      ? metadataWeatherForecastFor(selectedNode, selectedFileForecast, importedByCount)
      : null,
    [importedByCount, selectedFileForecast, selectedNode]
  );
  const selectedFilePressureRules = useMemo(
    () => selectedNode?.type === "file"
      ? pressureRuleCardsForFile(selectedNode, selectedFileForecast, importedByCount)
      : [],
    [importedByCount, selectedFileForecast, selectedNode]
  );
  const selectedFileHasPressure = selectedFilePressureRules.length > 0;
  const pressureSimulationActive = Boolean(
    pressureSimulation &&
      metadataForecastActive &&
      selectedNode?.type === "file" &&
      selectedNode.id === pressureSimulation.nodeId
  );
  const pressureSimulationProjection = useMemo(() => {
    if (
      !pressureSimulationActive ||
      !pressureSimulation ||
      !selectedNode ||
      selectedNode.type !== "file" ||
      !selectedFileForecast
    ) {
      return { nodes: [] as AtlasFlowNode[], edges: [] as AtlasFlowEdge[] };
    }

    const sourceFlowNode = displayedLayoutNodes.find((candidate) => (
      flowNodeRealId(candidate) === selectedNode.id &&
      Number((candidate.data as AtlasNode).corridorIndex ?? 0) === selectedCorridorIndex
    )) ?? displayedLayoutNodes.find((candidate) => flowNodeRealId(candidate) === selectedNode.id);

    if (!sourceFlowNode) {
      return { nodes: [] as AtlasFlowNode[], edges: [] as AtlasFlowEdge[] };
    }

    const sourceData = sourceFlowNode.data as AtlasNode;
    const sourcePosition = manualNodePositions[sourceFlowNode.id] ?? sourceFlowNode.position;
    const sourceWidth = Number(sourceData.layoutWidth ?? 148);
    const sourceHeight = Number(sourceData.layoutHeight ?? 102);
    const sourceCenterX = sourcePosition.x + sourceWidth / 2;
    const sourceCenterY = sourcePosition.y + sourceHeight / 2;
    const ghostBlocks = selectedFileForecast.suggested.slice(1, 7);
    const visibleFolders = pressureSimulationPhaseAtLeast(pressureSimulation.phase, "folders");
    const visibleFiles = pressureSimulationPhaseAtLeast(pressureSimulation.phase, "files");
    const visibleEdges = pressureSimulationPhaseAtLeast(pressureSimulation.phase, "edges");

    if (!visibleFolders || ghostBlocks.length === 0) {
      return { nodes: [] as AtlasFlowNode[], edges: [] as AtlasFlowEdge[] };
    }

    const ghostBlockLayouts = ghostBlocks.map((block, index) => {
      const responsibility = pressureResponsibilityForBlock(block);
      const duplicateSlot = ghostBlocks
        .slice(0, index)
        .filter((candidate) => pressureResponsibilityKeyForBlock(candidate) === pressureResponsibilityKeyForBlock(block))
        .length;
      const stagger = duplicateSlot * 72;

      return {
        block,
        responsibility,
        folderName: folderNameFromSuggestedTitle(block.title),
        fileName: fileNameFromSuggestedTitle(block.title),
        position: {
          x: sourceCenterX + responsibility.offsetX - 74 + (responsibility.offsetX === 0 ? stagger : 0),
          y: sourceCenterY + responsibility.offsetY - 51 + (responsibility.offsetY === 0 ? stagger : Math.sign(responsibility.offsetY) * stagger)
        }
      };
    });
    const folderGroups = [...new Set(ghostBlockLayouts.map((layout) => layout.folderName))]
      .map((folderName) => ({
        folderName,
        children: ghostBlockLayouts.filter((layout) => layout.folderName === folderName)
      }));

    const folderNodes: AtlasFlowNode[] = folderGroups.map(({ folderName, children }) => {
      const nodeId = `pressure-sim-folder:${selectedNode.id}:${folderName}`;
      const minX = Math.min(...children.map((layout) => layout.position.x));
      const minY = Math.min(...children.map((layout) => layout.position.y));
      const maxX = Math.max(...children.map((layout) => layout.position.x + 148));
      const maxY = Math.max(...children.map((layout) => layout.position.y + 102));
      const folderWidth = Math.max(178, maxX - minX + 34);
      const folderHeight = Math.max(142, maxY - minY + 42);
      const folderData: AtlasNode = {
        id: nodeId,
        type: "folder",
        label: `${folderName}/`,
        path: `${selectedNode.path}::projection/${folderName}`,
        parent: selectedNode.parent,
        healthTier: "unscored",
        metadata: {
          childCount: children.length
        },
        layoutWidth: folderWidth,
        layoutHeight: folderHeight,
        layoutScale: 0.86,
        pressureSimulationGhost: true
      };

      return {
        id: nodeId,
        type: "folder",
        position: {
          x: minX - 17,
          y: minY - 24
        },
        width: folderWidth,
        height: folderHeight,
        draggable: false,
        selectable: false,
        zIndex: 70,
        className: "pressure-ghost-node pressure-ghost-node--folder pressure-ghost-node--visible",
        data: folderData
      };
    });

    const fileNodes: AtlasFlowNode[] = ghostBlockLayouts.map((layout, index) => {
      const nodeId = `pressure-sim-file:${selectedNode.id}:${index}`;
      const fileData: AtlasNode = {
        id: nodeId,
        type: "file",
        label: layout.fileName,
        path: `${selectedNode.path}::projection/${layout.block.title}`,
        parent: `pressure-sim-folder:${selectedNode.id}:${layout.folderName}`,
        healthTier: "unscored",
        metadata: {
          extension: fileExtensionFromTitle(layout.fileName),
          linesOfCode: 0,
          functionCount: 0,
          importCount: 0
        },
        layoutWidth: 148,
        layoutHeight: 102,
        layoutScale: 0.92,
        pressureSimulationGhost: true,
        pressureSimulationChip: `${layout.responsibility.label} ${layout.responsibility.percent}%`
      };

      return {
        id: nodeId,
        type: "file",
        position: visibleFiles
          ? layout.position
          : { x: sourcePosition.x, y: sourcePosition.y },
        width: 148,
        height: 102,
        draggable: false,
        selectable: false,
        zIndex: 90,
        className: [
          "pressure-ghost-node",
          "pressure-ghost-node--file",
          visibleFiles ? "pressure-ghost-node--visible" : "pressure-ghost-node--pending"
        ].join(" "),
        data: fileData
      };
    });

    const fileEdges: AtlasFlowEdge[] = fileNodes.map((fileNode) => ({
      id: `pressure-sim-edge:${sourceFlowNode.id}->${fileNode.id}`,
      source: sourceFlowNode.id,
      target: fileNode.id,
      type: "structural",
      animated: true,
      zIndex: 75,
      data: {
        kind: "pressure-simulation",
        direction: "outgoing"
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#7dd3fc"
      }
    }));

    return {
      nodes: [...folderNodes, ...fileNodes],
      edges: visibleEdges && visibleFiles ? fileEdges : []
    };
  }, [
    displayedLayoutNodes,
    manualNodePositions,
    pressureSimulation,
    pressureSimulationActive,
    selectedCorridorIndex,
    selectedFileForecast,
    selectedNode
  ]);
  const renderedNodes = useMemo(
    () => [...nodes, ...pressureSimulationProjection.nodes],
    [nodes, pressureSimulationProjection.nodes]
  );
  const renderedEdges = useMemo(
    () => [...edges, ...pressureSimulationProjection.edges],
    [edges, pressureSimulationProjection.edges]
  );
  const selectedFileFunctionCount = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file" || !hasFunctionMetadata(selectedNode)) {
      return 0;
    }

    return selectedNode.metadata?.functionWaypoints?.length ?? selectedNode.metadata?.functionCount ?? 0;
  }, [selectedNode]);
  const selectedPressureFunctionRows = useMemo(
    () => selectedNode?.type === "file" ? pressureFunctionRowsForFile(selectedNode) : [],
    [selectedNode]
  );
  const selectedPressureFunction =
    selectedPressureFunctionRows.find((row) => row.id === selectedPressureFunctionId) ??
    selectedPressureFunctionRows[0] ??
    null;
  const selectedFileInspection = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return null;
    }

    return inspectSource(selectedNode);
  }, [selectedNode]);
  const selectedFileImportRows = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return [];
    }

    return parseImportNames(selectedNode.sourceText ?? "", selectedNode.metadata?.extension);
  }, [selectedNode]);
  const selectedFileRecentCommits = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return [];
    }

    return graph?.fileHistory?.[selectedNode.path]?.recentCommits.slice(0, 3) ?? [];
  }, [graph?.fileHistory, selectedNode]);
  const selectedFileRole = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file" || !selectedFileInspection) {
      return null;
    }

    return codebaseRoleFor(selectedNode, selectedFileInspection, importedByCount);
  }, [importedByCount, selectedFileInspection, selectedNode]);
  const selectedFileConnectionGroups = useMemo<ConnectedFileGroupsByDirection>(() => {
    if (!graph || !selectedNode || selectedNode.type !== "file") {
      return { imports: [], importedBy: [] };
    }

    const targetsByKey = new Map<string, ConnectedFileTarget>();
    const addTarget = (target: ConnectedFileTarget) => {
      const key = `${target.direction}:${target.node.id}`;
      const existing = targetsByKey.get(key);
      if (existing) {
        existing.edgeIds.push(...target.edgeIds);
        existing.line = existing.line ?? target.line;
        return;
      }

      targetsByKey.set(key, {
        ...target,
        edgeIds: [...target.edgeIds]
      });
    };

    graph.edges
      .filter((edge) => edge.source === selectedNode.id)
      .forEach((edge, index) => {
        const node = graphNodeById.get(edge.target) ?? null;
        if (node?.type === "file") {
          addTarget({
            node,
            direction: "imports",
            line: selectedFileImportRows[index]?.line ?? index + 1,
            edgeIds: [edge.id]
          });
        }
      });

    graph.edges
      .filter((edge) => edge.target === selectedNode.id)
      .forEach((edge) => {
        const node = graphNodeById.get(edge.source) ?? null;
        if (node?.type === "file") {
          addTarget({
            node,
            direction: "imported-by",
            line: null,
            edgeIds: [edge.id]
          });
        }
      });

    const selectedFolder = folderPathForFile(selectedNode);
    const selectedDepth = selectedFolder ? selectedFolder.split("/").length : 0;
    const groupTargets = (targets: ConnectedFileTarget[]): ConnectedFileGroup[] => {
      const groupsByFolder = new Map<string, ConnectedFileTarget[]>();

      for (const target of targets) {
        const folderPath = folderPathForFile(target.node);
        const existingTargets = groupsByFolder.get(folderPath) ?? [];
        existingTargets.push(target);
        groupsByFolder.set(folderPath, existingTargets);
      }

      return [...groupsByFolder.entries()]
        .map(([folderPath, folderTargets]) => {
          const depth = folderPath ? folderPath.split("/").length : 0;

          return {
            folderPath,
            label: folderLabel(folderPath),
            depthDelta: depth - selectedDepth,
            targets: folderTargets.sort((left, right) => (
              left.node.label.localeCompare(right.node.label) ||
              left.node.path.localeCompare(right.node.path)
            ))
          };
        })
        .sort((left, right) => {
          const leftSameFolder = left.folderPath === selectedFolder ? 0 : 1;
          const rightSameFolder = right.folderPath === selectedFolder ? 0 : 1;
          if (leftSameFolder !== rightSameFolder) {
            return leftSameFolder - rightSameFolder;
          }

          const leftDepthScore = left.depthDelta === 0 ? 0 : left.depthDelta > 0 ? 2 + left.depthDelta : 1 + Math.abs(left.depthDelta);
          const rightDepthScore = right.depthDelta === 0 ? 0 : right.depthDelta > 0 ? 2 + right.depthDelta : 1 + Math.abs(right.depthDelta);
          if (leftDepthScore !== rightDepthScore) {
            return leftDepthScore - rightDepthScore;
          }

          return left.label.localeCompare(right.label);
        });
    };
    const targets = [...targetsByKey.values()];

    return {
      imports: groupTargets(targets.filter((target) => target.direction === "imports")),
      importedBy: groupTargets(targets.filter((target) => target.direction === "imported-by"))
    };
  }, [graph, graphNodeById, selectedFileImportRows, selectedNode]);
  const selectedFileWeight = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return null;
    }

    return architecturalWeightFor(selectedNode, importedByCount);
  }, [importedByCount, selectedNode]);
  const selectedFileRoles = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return [];
    }

    return operationalRolesFor(selectedNode, importedByCount);
  }, [importedByCount, selectedNode]);
  const selectedRegionSummary = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type === "file") {
      return null;
    }

    return regionalSummaryFor(selectedNode, graph);
  }, [graph, selectedNode]);
  const runtimeOriginNode = runtimeState.originNodeId ? graphNodeById.get(runtimeState.originNodeId) ?? null : null;
  const runtimeCurrentNode = runtimeLayout?.activeNodeId ? graphNodeById.get(runtimeLayout.activeNodeId) ?? null : null;
  const runtimePreviousNode = runtimeLayout?.previousNodeId ? graphNodeById.get(runtimeLayout.previousNodeId) ?? null : null;
  const runtimeNextNode = runtimeLayout?.nextNodeId ? graphNodeById.get(runtimeLayout.nextNodeId) ?? null : null;
  const runtimeCandidateFiles = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type === "file") {
      return [];
    }

    const connectedFileIds = new Set<string>();

    for (const edge of graph.edges) {
      connectedFileIds.add(edge.source);
      connectedFileIds.add(edge.target);
    }

    return graph.nodes
      .filter((node) => node.type === "file" && node.parent === selectedNode.id)
      .sort((a, b) => {
        const connectionDifference = Number(connectedFileIds.has(b.id)) - Number(connectedFileIds.has(a.id));

        if (connectionDifference !== 0) {
          return connectionDifference;
        }

        return Number(b.metadata?.importCount ?? 0) - Number(a.metadata?.importCount ?? 0) || a.path.localeCompare(b.path);
      });
  }, [graph, selectedNode]);
  const selectedRuntimeFile = selectedRuntimeFileId ? graphNodeById.get(selectedRuntimeFileId) ?? null : null;
  const selectedInteractionResidue = selectedNode ? interactionResidueByNodeId[selectedNode.id] : undefined;
  const sourceModalImportedByCount =
    sourceModalFile && graph
      ? graph.edges.filter((edge) => edge.target === sourceModalFile.id).length
      : 0;
  const sourceModalHistory = sourceModalFile ? graph?.fileHistory?.[sourceModalFile.path] : undefined;
  const sourceModalFileContext = sourceModalFile
    ? {
        importCount: Number(sourceModalFile.metadata?.importCount ?? 0),
        importedByCount: sourceModalImportedByCount,
        weight: architecturalWeightFor(sourceModalFile, sourceModalImportedByCount),
        commitCount: sourceModalHistory?.commitCount,
        lastModified: sourceModalHistory?.lastModified
      }
    : undefined;
  const sourceModalInventoryFunctionCounts = useMemo(() => {
    if (!sourceModalFile || sourceModalInventoryMode !== "function-count") {
      return undefined;
    }

    const functions = sourceModalFile.metadata?.functionWaypoints ?? [];
    const complexFunctionCount = functions.filter((waypoint) =>
      Number(waypoint.cyclomaticComplexity ?? 0) > PRESSURE_CYCLOMATIC_TARGET ||
      Number(waypoint.cognitiveComplexity ?? 0) > PRESSURE_COGNITIVE_TARGET
    ).length;

    return [
      {
        id: "raw" as const,
        label: "Functions",
        value: Number(sourceModalFile.metadata?.functionCount ?? functions.length)
      },
      {
        id: "complex" as const,
        label: "Complex",
        value: complexFunctionCount
      }
    ];
  }, [sourceModalFile, sourceModalInventoryMode]);
  const sourceModalRuntimeNode =
    sourceModalFile && runtimeState.active
      ? runtimeState.chain?.nodes.find((node) => node.id === sourceModalFile.id)
      : undefined;
  const sourceModalRuntimeContext = sourceModalFile
    ? {
        inActiveCorridor: Boolean(sourceModalRuntimeNode),
        isCurrentNode: sourceModalRuntimeNode?.id === runtimeLayout?.activeNodeId,
        exploredAsOrigin: Number(interactionResidueByNodeId[sourceModalFile.id]?.runtimeActivationCount ?? 0) > 0,
        runtimeStep: sourceModalRuntimeNode?.runtimeStep
      }
    : undefined;
  const selectedWasRevisited = Number(selectedInteractionResidue?.focusCount ?? 0) > 1;
  const selectedWasRuntimeActivated = Number(selectedInteractionResidue?.runtimeActivationCount ?? 0) > 0;
  const visibleTraceCount =
    (relationLens?.visibleOutgoing.length ?? 0) + (relationLens?.visibleIncoming.length ?? 0);
  const actionSummary = !selectedNode
    ? ""
    : selectedNode.type === "file"
      ? visibleTraceCount > 0
        ? `Runtime X-Ray / ${visibleTraceCount} trace${visibleTraceCount === 1 ? "" : "s"}`
        : "Runtime X-Ray available"
      : [
          canEnter(selectedNode) ? "Enter" : null,
          runtimeCandidateFiles.length > 0
            ? `${runtimeCandidateFiles.length} local origin${runtimeCandidateFiles.length === 1 ? "" : "s"}`
            : null,
          visibleTraceCount > 0 ? `${visibleTraceCount} trace${visibleTraceCount === 1 ? "" : "s"}` : null
        ]
          .filter(Boolean)
          .join(" / ");
  const hasActivationSurface = Boolean(
    selectedNode &&
      (selectedNode.type === "file" ||
        canEnter(selectedNode) ||
        runtimeCandidateFiles.length > 0 ||
        visibleTraceCount > 0)
  );
  const interactionSummary = selectedWasRuntimeActivated
    ? "Runtime explored earlier"
    : selectedWasRevisited
      ? "Previously focused"
      : "No prior residue";
  const activeSecondaryRegion =
    selectedNode && expandedPanelRegion.nodeId === selectedNode.id ? expandedPanelRegion.region : null;

  const toggleSecondaryRegion = useCallback((region: SecondaryPanelRegion) => {
    if (!selectedNode) {
      return;
    }

    setExpandedPanelRegion((current) => ({
      nodeId: selectedNode.id,
      region: current.nodeId === selectedNode.id && current.region === region ? null : region
    }));
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedNode || selectedNode.type === "file") {
      setSelectedRuntimeFileId(null);
      return;
    }

    setSelectedRuntimeFileId((currentFileId) => {
      if (currentFileId && runtimeCandidateFiles.some((file) => file.id === currentFileId)) {
        return currentFileId;
      }

      return runtimeCandidateFiles[0]?.id ?? null;
    });
  }, [runtimeCandidateFiles, selectedNode]);

  const handleTimelineReset = useCallback(() => {
    setTemporalIndex(0);
    setFocusedLandmarkId(null);
  }, []);

  const handleTemporalScrub = useCallback(
    (nextIndex: number) => {
      const clamped = Math.min(Math.max(0, nextIndex), Math.max(0, temporalStates.length - 1));
      const snapped = snapToLandmark(clamped, temporalLandmarks, 1);

      setTemporalIndex(snapped);
      setFocusedLandmarkId(temporalLandmarks.find((landmark) => landmark.index === snapped)?.id ?? null);
    },
    [temporalLandmarks, temporalStates.length]
  );

  const handleLandmarkFocus = useCallback((landmarkId: string) => {
    const landmark = temporalLandmarks.find((item) => item.id === landmarkId);
    if (!landmark) {
      return;
    }

    setFocusedLandmarkId(landmark.id);
    setTemporalIndex(landmark.index);
  }, [temporalLandmarks]);

  const startRuntimeFromFile = useCallback((fileNodeId: string) => {
    if (!graph) {
      return;
    }

    const fileNode = graphNodeById.get(fileNodeId);

    if (!fileNode || fileNode.type !== "file") {
      return;
    }

    const chain = buildRuntimeChain(graph, fileNode.id);

    if (!chain) {
      return;
    }

    recordRuntimeActivation(fileNode.id);
    setFocusedNodeId(fileNode.id);
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
    setRuntimeNodePositions({});
    setRuntimeState({
      active: true,
      originNodeId: fileNode.id,
      currentStep: 0,
      chain
    });
    setRuntimePlaybackActive(chain.nodes.length > 1);
  }, [graph, graphNodeById, recordRuntimeActivation]);

  const handleRuntimeStart = useCallback(() => {
    if (!selectedNode) {
      return;
    }

    if (selectedNode.type === "file") {
      startRuntimeFromFile(selectedNode.id);
      return;
    }

    if (selectedRuntimeFileId) {
      startRuntimeFromFile(selectedRuntimeFileId);
    }
  }, [selectedNode, selectedRuntimeFileId, startRuntimeFromFile]);

  const centerVisibleGraphNode = useCallback((node: AtlasNode, zoomFloor = 1.12, duration = 420) => {
    if (!reactFlowInstance) {
      return;
    }

    const flowNode = renderedNodes.find((candidate) => (
      flowNodeRealId(candidate) === node.id &&
      Number((candidate.data as AtlasNode).corridorIndex ?? 0) === selectedCorridorIndex
    )) ?? renderedNodes.find((candidate) => flowNodeRealId(candidate) === node.id);

    if (!flowNode) {
      return;
    }

    const bounds = reactFlowInstance.getNodesBounds([flowNode]);
    void reactFlowInstance.setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
      zoom: Math.max(reactFlowInstance.getViewport().zoom, zoomFloor),
      duration
    });
  }, [reactFlowInstance, renderedNodes, selectedCorridorIndex]);

  const clearPressureSimulationTimers = useCallback(() => {
    for (const timerId of pressureSimulationTimerRef.current) {
      window.clearTimeout(timerId);
    }

    pressureSimulationTimerRef.current = [];
  }, []);

  const exitPressureSimulation = useCallback(() => {
    clearPressureSimulationTimers();
    setPressureSimulation(null);
  }, [clearPressureSimulationTimers]);

  const showPressureImpact = useCallback(() => {}, []);

  const openPressureAnalysisWindow = useCallback(() => {
    setPressureAnalysisWindowOpen(true);
    bringToFront(PRESSURE_ANALYSIS_WINDOW_ID);
  }, [bringToFront]);

  const startPressureSimulation = useCallback(() => {
    if (!selectedNode || selectedNode.type !== "file" || !selectedFileForecast?.available) {
      return;
    }

    clearPressureSimulationTimers();
    setMetadataForecastNodeId(selectedNode.id);
    openPressureAnalysisWindow();
    setFilePanelView("metadata");
    setFocusedNodeId(selectedNode.id);
    setPressureSimulation({ nodeId: selectedNode.id, phase: "centering" });
    centerVisibleGraphNode(selectedNode, 1.18, 520);

    pressureSimulationTimerRef.current = [
      window.setTimeout(() => {
        setPressureSimulation((current) => current?.nodeId === selectedNode.id ? { ...current, phase: "folders" } : current);
      }, 300),
      window.setTimeout(() => {
        setPressureSimulation((current) => current?.nodeId === selectedNode.id ? { ...current, phase: "files" } : current);
      }, 650),
      window.setTimeout(() => {
        setPressureSimulation((current) => current?.nodeId === selectedNode.id ? { ...current, phase: "edges" } : current);
      }, 980)
    ];
  }, [centerVisibleGraphNode, clearPressureSimulationTimers, openPressureAnalysisWindow, selectedFileForecast?.available, selectedNode]);

  const enterMetadataForecast = useCallback(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return;
    }

    setMetadataForecastNodeId(selectedNode.id);
    openPressureAnalysisWindow();
    setActivePressureInvestigation(null);
    setSelectedPressureFunctionId(null);
    setFilePanelView("metadata");
    setFocusedNodeId(selectedNode.id);
    centerVisibleGraphNode(selectedNode);
  }, [centerVisibleGraphNode, openPressureAnalysisWindow, selectedNode]);

  const investigatePressureRule = useCallback((rule: PressureRuleCard) => {
    if (!selectedNode || selectedNode.type !== "file") {
      return;
    }

    if (rule.action === "function-inventory") {
      setSourceModalInventoryMode("function-count");
      setSourceModalFile(selectedNode);
      return;
    }

    if (rule.action === "function-loc") {
      const firstLargeFunction = pressureFunctionRowsForFile(selectedNode)
        .find((row) => row.lineCount > PRESSURE_FUNCTION_LOC_TARGET);
      setSelectedPressureFunctionId(firstLargeFunction?.id ?? null);
    }

    setActivePressureInvestigation({
      kind: rule.action,
      title: rule.title
    });
  }, [selectedNode]);

  const openWiresPanel = useCallback(() => {
    setMetadataForecastNodeId(null);
    setActivePressureInvestigation(null);
    exitPressureSimulation();
    setFilePanelView("wires");
  }, [exitPressureSimulation]);

  const openMetadataPanel = useCallback(() => {
    setMetadataForecastNodeId(null);
    setActivePressureInvestigation(null);
    exitPressureSimulation();
    setFilePanelView("metadata");
  }, [exitPressureSimulation]);

  useEffect(() => {
    return () => clearPressureSimulationTimers();
  }, [clearPressureSimulationTimers]);

  useEffect(() => {
    if (!pressureSimulation) {
      return;
    }

    if (selectedNode?.id !== pressureSimulation.nodeId) {
      exitPressureSimulation();
    }
  }, [exitPressureSimulation, pressureSimulation, selectedNode?.id]);

  useEffect(() => {
    if (!reactFlowInstance || !pressureSimulationActive || !pressureSimulation) {
      return;
    }

    if (pressureSimulation.phase !== "files" && pressureSimulation.phase !== "edges") {
      return;
    }

    const simulationNodeIds = renderedNodes
      .filter((node) => (
        flowNodeRealId(node) === pressureSimulation.nodeId ||
        (node.data as AtlasNode).pressureSimulationGhost === true
      ))
      .map((node) => ({ id: node.id }));

    if (simulationNodeIds.length < 2) {
      return;
    }

    void reactFlowInstance.fitView({
      nodes: simulationNodeIds,
      padding: 0.22,
      duration: 520,
      minZoom: 0.72,
      maxZoom: 1.08
    });
  }, [pressureSimulation, pressureSimulationActive, reactFlowInstance, renderedNodes]);

  const focusGraphNode = useCallback((node: AtlasNode, relationshipContext?: RelationshipFollowContext) => {
    const originFileNode = selectedNode?.type === "file" ? selectedNode : null;
    const originCorridorIndex = selectedCorridorIndex;
    recordNodeFocus(node.id);
    setFocusedNodeId(node.id);
    setFilePanelView("metadata");
    setExpandedPanelRegion({ nodeId: node.id, region: null });
    setSelectedNode(node);

    const targetContextId = node.type === "file" ? node.parent ?? null : node.id;
    const originContextId = selectedCorridorIndex === 0
      ? currentContextId
      : linkedCorridors[selectedCorridorIndex - 1]?.contextId ?? null;
    if (node.type === "file" && graph) {
      const existingLinkedIndex = linkedCorridors.findIndex((corridor) => corridor.contextId === targetContextId);
      const targetCorridorIndex = targetContextId === currentContextId
        ? 0
        : existingLinkedIndex >= 0
          ? existingLinkedIndex + 1
          : linkedCorridors.length + 1;
      const targetPageIndex = pageIndexContainingNode(graph, targetContextId, node.id);
      const isSameContextFollow = targetContextId === originContextId;

      if (relationshipContext && originFileNode && originFileNode.id !== node.id) {
        setCorridorLinks((current) => {
          const exists = current.some((link) => (
            link.originCorridorIndex === originCorridorIndex &&
            link.originNodeId === originFileNode.id &&
            link.targetCorridorIndex === targetCorridorIndex &&
            link.targetNodeId === node.id &&
            link.direction === relationshipContext.direction
          ));

          return exists
            ? current
            : [
                ...current,
                {
                  originCorridorIndex,
                  originNodeId: originFileNode.id,
                  targetCorridorIndex,
                  targetNodeId: node.id,
                  direction: relationshipContext.direction,
                  subdued: isSameContextFollow
                }
              ];
        });
      }

      if (targetContextId !== originContextId) {
        if (targetCorridorIndex > 0) {
          setLinkedCorridors((current) => {
            if (existingLinkedIndex >= 0) {
              return current.map((corridor, index) => (
                index === existingLinkedIndex
                  ? { ...corridor, focusedNodeId: node.id, pageIndex: targetPageIndex }
                  : corridor
              ));
            }

            return [
              ...current,
              {
                contextId: targetContextId,
                focusedNodeId: node.id,
                pageIndex: targetPageIndex
              }
            ];
          });
        } else {
          pendingPrimaryFocusNodeIdRef.current = node.id;
          setPageIndex(targetPageIndex);
        }

        setSelectedCorridorIndex(targetCorridorIndex);
        return;
      }

      setSelectedCorridorIndex(targetCorridorIndex);
    }

    if (!reactFlowInstance) {
      return;
    }

    const flowNode = nodes.find((candidate) => (
      flowNodeRealId(candidate) === node.id &&
      Number((candidate.data as AtlasNode).corridorIndex ?? 0) === selectedCorridorIndex
    )) ?? null;
    if (!flowNode) {
      if (graph) {
        pendingPrimaryFocusNodeIdRef.current = node.id;
        if (selectedCorridorIndex === 0) {
          setPageIndex(pageIndexContainingNode(graph, currentContextId, node.id));
        } else {
          setLinkedCorridors((current) => current.map((corridor, index) => (
            index === selectedCorridorIndex - 1
              ? { ...corridor, pageIndex: pageIndexContainingNode(graph, corridor.contextId, node.id) }
              : corridor
          )));
        }
      }
      return;
    }

    const bounds = reactFlowInstance.getNodesBounds([flowNode]);
    void reactFlowInstance.setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
      zoom: Math.max(reactFlowInstance.getViewport().zoom, 1.1),
      duration: 420
    });
  }, [currentContextId, graph, linkedCorridors, nodes, reactFlowInstance, recordNodeFocus, selectedCorridorIndex, selectedNode]);

  const handleResetCorridors = useCallback(() => {
    setLinkedCorridors([]);
    setCorridorLinks([]);
    setSelectedCorridorIndex(0);
    setFocusedNodeId(null);
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
    setExpandedPanelRegion({ nodeId: null, region: null });
    setSelectedNode(null);
    setFilePanelView("metadata");
    centeredSecondaryFocusKeyRef.current = null;
    pendingPrimaryFocusNodeIdRef.current = null;
  }, []);

  const handleRuntimeExit = useCallback(() => {
    setRuntimeState(inactiveRuntimeState);
    setRuntimePlaybackActive(false);
    setRuntimeNodePositions({});
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
  }, []);

  const handleRuntimeScrub = useCallback((step: number) => {
    setRuntimePlaybackActive(false);
    setRuntimeState((current) => {
      if (!current.active || !current.chain) {
        return current;
      }

      return {
        ...current,
        currentStep: Math.min(Math.max(0, step), Math.max(0, current.chain.nodes.length - 1))
      };
    });
  }, []);

  const handleRuntimeReplay = useCallback(() => {
    setRuntimeState((current) => {
      if (!current.active || !current.chain) {
        return current;
      }

      return {
        ...current,
        currentStep: 0
      };
    });
    setRuntimePlaybackActive(true);
  }, []);

  const handleRuntimeTogglePlay = useCallback(() => {
    setRuntimePlaybackActive((isPlaying) => !isPlaying);
  }, []);

  const handleNodeClick: NodeMouseHandler<AtlasFlowNode> = (_event, node) => {
    if (structuralSelectionActive) {
      return;
    }

    if (isLineageNode(node)) {
      const data = node.data as AtlasNode;

      navigateToContext(data.id === "root" ? null : data.id);
      return;
    }

    if (!isStructuralNode(node)) {
      return;
    }

    const realNodeId = flowNodeRealId(node);
    const graphNode = graphNodeById.get(realNodeId) ?? (node.data as AtlasNode);
    const corridorIndex = Number((node.data as AtlasNode).corridorIndex ?? 0);

    recordNodeFocus(realNodeId);
    setFilePanelView("metadata");
    setExpandedPanelRegion({ nodeId: realNodeId, region: null });
    setFocusedNodeId(realNodeId);
    setSelectedNode(graphNode);
    setSelectedCorridorIndex(corridorIndex);
  };

  const handleNodeDoubleClick: NodeMouseHandler<AtlasFlowNode> = (_event, node) => {
    if (structuralSelectionActive) {
      return;
    }

    if (isLineageNode(node)) {
      const data = node.data as AtlasNode;

      navigateToContext(data.id === "root" ? null : data.id);
      return;
    }

    if (!isStructuralNode(node)) {
      return;
    }

    const data = node.data as AtlasNode;
    const realNodeId = flowNodeRealId(node);
    const graphNode = graphNodeById.get(realNodeId) ?? data;
    const corridorIndex = Number(data.corridorIndex ?? 0);

    if (canEnter(graphNode)) {
      recordNodeFocus(graphNode.id);
      navigateToContext(graphNode.id);
      return;
    }

    recordNodeFocus(realNodeId);
    setFilePanelView("metadata");
    setExpandedPanelRegion({ nodeId: realNodeId, region: null });
    setFocusedNodeId(realNodeId);
    setSelectedNode(graphNode);
    setSelectedCorridorIndex(corridorIndex);
  };

  function navigateToContext(contextId: string | null): void {
    const target = contextId ? graph?.nodes.find((node) => node.id === contextId) : null;
    const entersChildContext =
      Boolean(contextId) &&
      target?.type === "folder" &&
      (target.parent ?? null) === currentContextId;
    const exitsToAncestorContext = contextId !== currentContextId && (
      contextId === null ||
      Boolean(currentContextId?.startsWith(`${contextId}/`))
    );

    pendingContextCameraRef.current = (entersChildContext || exitsToAncestorContext) && reactFlowInstance
      ? {
          contextId,
          zoom: reactFlowInstance.getViewport().zoom
        }
      : null;

    if (contextId !== currentContextId) {
      setPageIndex(0);
      setRuntimeNodePositions({});
      setRuntimeState(inactiveRuntimeState);
      setRuntimePlaybackActive(false);
    }

    setCurrentContextId(contextId);
  }

  function goToPage(nextPageIndex: number): void {
    if (!laidOut) {
      return;
    }

    setFocusedNodeId(null);
    setTracedEdgeIds([]);
    setTracedFolderRelationCounts({});
    setSelectedObjectIds([]);
    setSelectedNode(null);
    setFilePanelView("metadata");
    setPageIndex(Math.min(Math.max(0, nextPageIndex), laidOut.totalPages - 1));
  }

  if (!graph || !laidOut || !structuralState) {
    if (githubConnected || graph) {
      return <div className="graph-shell graph-shell--empty" />;
    }

    return (
      <div className="graph-idle-state">
        <div className="graph-idle-state__ambient" aria-hidden="true" />
        <div className="graph-idle-state__content">
          <div className="graph-idle-state__eyebrow">Code Atlas</div>
          <h2 className="graph-idle-state__headline">Understand any codebase before you touch it</h2>
          <p className="graph-idle-state__subline">
            Paste a GitHub URL. Get a spatial graph, health scores, and a concrete refactor plan - in seconds.
          </p>

          <form
            className="graph-idle-state__url-row"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              onAnalyzeRepoUrl(String(formData.get("repoUrl") ?? ""));
            }}
          >
            <input
              name="repoUrl"
              value={repoUrl}
              onChange={(event) => onRepoUrlChange(event.target.value)}
              placeholder="https://github.com/owner/repo"
              aria-label="GitHub repository URL"
              disabled={isAnalyzing}
            />
            <button type="submit" disabled={isAnalyzing || repoUrl.trim().length === 0}>
              {isAnalyzing ? "Analyzing" : "Analyze"}
            </button>
          </form>
          {isAnalyzing ? (
            <div className="graph-idle-state__progress" aria-live="polite">
              <span
                className={`analyze-progress-meter analyze-progress-meter--${analyzeProgressMode}`}
                style={{
                  "--analysis-progress-angle": `${analyzeProgressPercent * 3.6}deg`,
                  "--analysis-progress-transition-ms": `${analyzeProgressTransitionMs}ms`
                } as CSSProperties}
                aria-hidden="true"
              >
                <span className="analyze-progress-meter__ring" />
                <span className="analyze-progress-meter__line"><span /></span>
              </span>
              <span>Analyzing repository</span>
              <strong>
                {analyzeElapsedLabel ?? "starting"}
                {analyzeEstimateLabel ? ` / est ${analyzeEstimateLabel}` : ""}
              </strong>
            </div>
          ) : isEstimatingAnalyze || analyzeEstimateLabel ? (
            <div className="graph-idle-state__progress" aria-live="polite">
              <span>{isEstimatingAnalyze ? "Estimating analysis" : "Estimated analysis"}</span>
              <strong>{isEstimatingAnalyze ? "checking" : analyzeEstimateLabel}</strong>
              {analyzeEstimateMeta ? <small>{analyzeEstimateMeta}</small> : null}
            </div>
          ) : null}

          <div className="graph-idle-state__divider" aria-hidden="true">
            <span />
            <span>or</span>
            <span />
          </div>

          <button type="button" className="graph-idle-state__connect" disabled={!onConnectGitHub} onClick={onConnectGitHub}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.545 2 12.162c0 4.494 2.865 8.308 6.839 9.654.5.093.682-.22.682-.49 0-.242-.008-.883-.012-1.734-2.782.618-3.369-1.37-3.369-1.37-.455-1.19-1.11-1.507-1.11-1.507-.907-.631.069-.618.069-.618 1.003.072 1.53 1.053 1.53 1.053.892 1.554 2.341 1.105 2.91.844.09-.659.35-1.105.636-1.359-2.22-.259-4.555-1.136-4.555-5.057 0-1.117.39-2.031 1.029-2.748-.103-.258-.446-1.299.098-2.707 0 0 .84-.274 2.75 1.05A9.27 9.27 0 0 1 12 7.116c.85.004 1.706.117 2.506.343 1.909-1.324 2.748-1.05 2.748-1.05.546 1.408.203 2.449.1 2.707.64.717 1.028 1.631 1.028 2.748 0 3.931-2.339 4.795-4.566 5.048.359.318.678.945.678 1.905 0 1.376-.012 2.485-.012 2.823 0 .272.18.588.688.489C19.137 20.467 22 16.654 22 12.162 22 6.545 17.523 2 12 2z" />
            </svg>
            <span>Connect GitHub</span>
          </button>

          <div className="graph-idle-state__pills" aria-label="Feature highlights">
            <span className="graph-idle-state__pill">
              <span className="graph-idle-state__dot is-cyan" />
              <span>Spatial graph navigation</span>
            </span>
            <span className="graph-idle-state__pill">
              <span className="graph-idle-state__dot is-amber" />
              <span>Health scoring</span>
            </span>
            <span className="graph-idle-state__pill">
              <span className="graph-idle-state__dot is-indigo" />
              <span>Pressure analysis</span>
            </span>
            <span className="graph-idle-state__pill">
              <span className="graph-idle-state__dot is-cyan" />
              <span>No LLMs</span>
            </span>
          </div>

          <div className="demo-video-slot" style={{ width: "100%", minHeight: "88px", marginTop: "16px", marginBottom: "16px" }} />

          <div className="graph-idle-state__examples-label">Try with a public repo</div>
          <div className="graph-idle-state__repo-chips" aria-label="Example repositories">
            {[
              { label: "facebook/react", url: "https://github.com/facebook/react" },
              { label: "vercel/next.js", url: "https://github.com/vercel/next.js" },
              { label: "vitejs/vite", url: "https://github.com/vitejs/vite" },
              { label: "expressjs/express", url: "https://github.com/expressjs/express" }
            ].map((repository) => (
              <button
                key={repository.url}
                type="button"
                className="graph-idle-state__repo-chip"
                onClick={() => onAnalyzeExampleRepo(repository.url, repository.label)}
              >
                {repository.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={graphShellRef}
      className={[
        "graph-shell",
        structuralSelectionActive ? "is-selection-mode" : "",
        refactorRiskMode ? "is-refactor-risk-mode" : "",
        refactorRiskScanActive ? "is-refactor-risk-scanning" : "",
        pressureSimulationActive ? "is-pressure-simulation-mode" : ""
      ].filter(Boolean).join(" ")}
      onPointerDownCapture={handleSelectionPointerDownCapture}
      onPointerMoveCapture={handleSelectionPointerMoveCapture}
    >
      <div className="breadcrumb-bar" aria-label="Current graph context">
        {laidOut.breadcrumbPath.map((item, index) => (
          <span className="breadcrumb-bar__item" key={item.id ?? "root"}>
            {index > 0 ? <span className="breadcrumb-bar__separator">/</span> : null}
            <button
              type="button"
              className={index === laidOut.breadcrumbPath.length - 1 ? "breadcrumb-bar__button is-active" : "breadcrumb-bar__button"}
              onClick={() => navigateToContext(item.id)}
            >
              {item.label}
            </button>
          </span>
        ))}
      </div>
      <div className="selection-tool-overlay" aria-label="Graph tools">
        <button
          type="button"
          className={refactorRiskMode ? "select-tool-button select-tool-button--risk is-active" : "select-tool-button select-tool-button--risk"}
          aria-pressed={refactorRiskMode}
          aria-label="Risk X-Ray"
          title="Risk X-Ray: color files by deterministic refactor pressure"
          onClick={handleRefactorRiskToggle}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12h4l2-6 4 12 2-6h4" />
            <path d="M4 20h16" />
            <path d="M4 4h16" />
          </svg>
          <span>X-Ray</span>
        </button>
        <button
          type="button"
          className={selectionToolActive ? "select-tool-button is-active" : "select-tool-button"}
          aria-pressed={selectionToolActive}
          aria-label="Select objects"
          title="Select objects in a dragged zone and move them together"
          onClick={() => setSelectionToolActive((active) => !active)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8V4h4" />
            <path d="M16 4h4v4" />
            <path d="M20 16v4h-4" />
            <path d="M8 20H4v-4" />
            <path d="m11 9 5 8-4-1-2 3z" />
          </svg>
          <span>Select</span>
        </button>
        <button
          type="button"
          className="select-tool-button select-tool-button--reset"
          aria-label="Reset linked corridors"
          title="Reset linked corridors"
          onClick={handleResetCorridors}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v6h6" />
          </svg>
          <span>Reset</span>
        </button>
      </div>
      {refactorRiskMode ? (
        <div className="refactor-risk-legend" aria-label="Risk X-Ray category legend">
          {REFACTOR_RISK_LEGEND_TIERS.map((tier) => (
            <div className="refactor-risk-legend__item" key={tier}>
              <span className={`refactor-risk-legend__dot refactor-risk-legend__dot--${tier}`} aria-hidden="true" />
              <span>{REFACTOR_RISK_LABELS[tier]}</span>
            </div>
          ))}
        </div>
      ) : null}
      {refactorRiskScanActive ? <div className="refactor-risk-scanline" aria-hidden="true" /> : null}

      <ReactFlow<AtlasFlowNode, AtlasFlowEdge>
        nodes={renderedNodes}
        edges={renderedEdges}
        onNodesChange={handleNodesChange}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.36, duration: 420 }}
        minZoom={0.18}
        maxZoom={1.45}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={structuralSelectionActive}
        selectionOnDrag={structuralSelectionActive}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        selectNodesOnDrag={structuralSelectionActive}
        deleteKeyCode={null}
        connectOnClick={false}
        nodeClickDistance={8}
        panOnDrag={structuralSelectionActive ? [1, 2] : true}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        onMoveEnd={(_event, viewport) => setViewportSnapshot(viewport)}
        onInit={setReactFlowInstance}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onSelectionChange={handleSelectionChange}
        onSelectionStart={handleSelectionStart}
        onSelectionEnd={handleSelectionEnd}
        onPaneClick={() => {
          if (runtimeState.active) {
            handleRuntimeExit();
            return;
          }

          if (structuralSelectionActive) {
            setSelectedObjectIds([]);
            return;
          }

          setFocusedNodeId(null);
          setTracedEdgeIds([]);
          setTracedFolderRelationCounts({});
          setExpandedPanelRegion({ nodeId: null, region: null });
          setSelectedNode(null);
          setFilePanelView("metadata");
          exitPressureSimulation();
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#263244" />
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          bgColor="#020617"
          nodeColor={(node) => {
            if (typeof (node.data as AtlasNode).lineageKind === "string") {
              return "#64748b";
            }

            return node.type === "folder"
              ? "#38bdf8"
              : minimapColorForFile((node.data as AtlasNode).metadata?.extension);
          }}
          nodeStrokeColor="#e5eefb"
          nodeStrokeWidth={2}
          maskColor="rgba(2, 6, 23, 0.72)"
          maskStrokeColor="rgba(125, 211, 252, 0.55)"
          maskStrokeWidth={1}
        />
      </ReactFlow>

      {runtimeState.active && runtimeState.chain ? (
        <RuntimeScrubber
          chain={runtimeState.chain}
          currentStep={runtimeState.currentStep}
          isPlaying={runtimePlaybackActive}
          onScrub={handleRuntimeScrub}
          onReplay={handleRuntimeReplay}
          onTogglePlay={handleRuntimeTogglePlay}
        />
      ) : (
        <TemporalScrubber
          totalStates={temporalStates.length}
          currentIndex={temporalIndex}
          activeDate={activeTemporalDate}
          landmarks={temporalLandmarks}
          focusedLandmarkId={focusedLandmarkId}
          isCollapsed={timelineCollapsed}
          onScrub={handleTemporalScrub}
          onLandmarkFocus={handleLandmarkFocus}
          onReset={handleTimelineReset}
          onToggleCollapsed={() => setTimelineCollapsed((collapsed) => !collapsed)}
        />
      )}
      <RawHistoryInspector
        visible={!runtimeState.active && !timelineCollapsed && Boolean(focusedLandmark)}
        landmark={focusedLandmark}
        commits={commits}
      />

      {pressureSimulationActive ? (
        <div className="pressure-simulation-header" aria-label="Simulation mode">
          <div>
            <strong>SIMULATION MODE</strong>
            <span>Pressure redistribution preview</span>
            <small>This is a projection, not an actual refactor.</small>
          </div>
          <div className="pressure-simulation-header__actions">
            <button type="button" onClick={showPressureImpact} disabled={pressureSimulation?.phase !== "edges"}>Show Impact</button>
            <button
              type="button"
              onClick={() => {
                exitPressureSimulation();
              }}
            >
              Exit Simulation
            </button>
          </div>
        </div>
      ) : null}

      <div className="context-panel">
        <div className="context-panel__label">Structural - Level {laidOut.level + 1}</div>
        <div className="context-panel__title">{laidOut.contextLabel}</div>
        <div className="context-panel__meta">
          {laidOut.visibleChildren} visible of {laidOut.totalChildren}
          {laidOut.hiddenChildren > 0 ? ` - page ${laidOut.currentPage + 1}/${laidOut.totalPages}` : ""}
        </div>
        {laidOut.totalPages > 1 ? (
          <div className="context-panel__pager" aria-label="Context page controls">
            <button type="button" onClick={() => goToPage(laidOut.currentPage - 1)} disabled={laidOut.currentPage === 0}>
              Prev
            </button>
            <button
              type="button"
              onClick={() => goToPage(laidOut.currentPage + 1)}
              disabled={laidOut.currentPage >= laidOut.totalPages - 1}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {currentContextId ? (
        <button type="button" className="overview-button" onClick={() => navigateToContext(null)}>
          Overview
        </button>
      ) : null}

      {runtimeState.active && runtimeState.chain ? (
        <RuntimeXRayOverlay
          chain={runtimeState.chain}
          originNode={runtimeOriginNode}
          currentNode={runtimeCurrentNode}
          previousNode={runtimePreviousNode}
          nextNode={runtimeNextNode}
          onExit={handleRuntimeExit}
        />
      ) : selectedNode ? (
        selectedNode.type === "file" ? (
          <aside
            className={`metadata-panel metadata-panel--file ${
              filePanelView === "wires"
                ? "metadata-panel--wires"
                : ""
            }`.trim()}
          >
            {filePanelView === "wires" ? (
              <>
                <section className="metadata-panel__section metadata-panel__header-section metadata-panel__wires-header" aria-label="Wires header">
                  <div className="metadata-panel__switch-title-row">
                    <div>
                      <div className="metadata-panel__eyebrow">Wires</div>
                      <div className="metadata-panel__filename">Wires</div>
                    </div>
                    <button
                      type="button"
                      className="metadata-panel__switch-button"
                      onClick={openMetadataPanel}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 5h14v14H5z" />
                        <path d="M8 9h8" />
                        <path d="M8 13h5" />
                      </svg>
                      <span>Details</span>
                    </button>
                  </div>
                  <div className="metadata-panel__path">{selectedNode.label}</div>
                  <div className="metadata-panel__wires-summary">
                    <span><strong>{selectedNode.metadata?.importCount ?? 0}</strong> out</span>
                    <span><strong>{importedByCount}</strong> in</span>
                  </div>
                </section>

                <section className="metadata-panel__section metadata-panel__wires-section" aria-label="File wires">
                  <div className="metadata-panel__import-list" aria-label="Connected files">
                    {selectedFileConnectionGroups.imports.length > 0 ? (
                      <div className={`metadata-panel__connection-section ${collapsedFileConnectionSectionSet.has("imports") ? "is-collapsed" : "is-expanded"}`.trim()}>
                        <button
                          type="button"
                          className="metadata-panel__connection-heading"
                          aria-expanded={!collapsedFileConnectionSectionSet.has("imports")}
                          onClick={() => toggleFileConnectionSection("imports")}
                        >
                          <span>Imports</span>
                          <strong>{selectedNode.metadata?.importCount ?? 0}</strong>
                          <span className="metadata-panel__connection-heading-chevron" aria-hidden="true" />
                        </button>
                        {!collapsedFileConnectionSectionSet.has("imports") ? (
                          selectedFileConnectionGroups.imports.map((group) => (
                            <div className="metadata-panel__import-group" key={`imports:${group.folderPath || "root"}`}>
                              <div className="metadata-panel__import-group-title">
                                <span>{group.label}</span>
                                <small>{group.depthDelta === 0 ? "same depth" : group.depthDelta > 0 ? "nested" : "parent"}</small>
                              </div>
                              {group.targets.map(({ node, line, edgeIds }) => (
                                <button
                                  key={`imports:${node.id}`}
                                  type="button"
                                  className="metadata-panel__import-row metadata-panel__import-row--imports"
                                  onClick={() => focusGraphNode(node, { direction: "imports" })}
                                  onFocus={() => handleTraceStart(edgeIds)}
                                  onBlur={handleTraceEnd}
                                  onPointerEnter={() => handleTraceStart(edgeIds)}
                                  onPointerLeave={handleTraceEnd}
                                >
                                  <span className="metadata-panel__import-name">{node.label}</span>
                                  <span className="metadata-panel__import-line">{line ? `:${line}` : "import"}</span>
                                </button>
                              ))}
                            </div>
                          ))
                        ) : null}
                      </div>
                    ) : null}

                    {selectedFileConnectionGroups.importedBy.length > 0 ? (
                      <div className={`metadata-panel__connection-section ${collapsedFileConnectionSectionSet.has("imported-by") ? "is-collapsed" : "is-expanded"}`.trim()}>
                        <button
                          type="button"
                          className="metadata-panel__connection-heading"
                          aria-expanded={!collapsedFileConnectionSectionSet.has("imported-by")}
                          onClick={() => toggleFileConnectionSection("imported-by")}
                        >
                          <span>Imported by</span>
                          <strong>{importedByCount}</strong>
                          <span className="metadata-panel__connection-heading-chevron" aria-hidden="true" />
                        </button>
                        {!collapsedFileConnectionSectionSet.has("imported-by") ? (
                          selectedFileConnectionGroups.importedBy.map((group) => (
                            <div className="metadata-panel__import-group" key={`imported-by:${group.folderPath || "root"}`}>
                              <div className="metadata-panel__import-group-title">
                                <span>{group.label}</span>
                                <small>{group.depthDelta === 0 ? "same depth" : group.depthDelta > 0 ? "nested" : "parent"}</small>
                              </div>
                              {group.targets.map(({ node, edgeIds }) => (
                                <button
                                  key={`imported-by:${node.id}`}
                                  type="button"
                                  className="metadata-panel__import-row metadata-panel__import-row--imported-by"
                                  onClick={() => focusGraphNode(node, { direction: "imported-by" })}
                                  onFocus={() => handleTraceStart(edgeIds)}
                                  onBlur={handleTraceEnd}
                                  onPointerEnter={() => handleTraceStart(edgeIds)}
                                  onPointerLeave={handleTraceEnd}
                                >
                                  <span className="metadata-panel__import-name">{node.label}</span>
                                  <span className="metadata-panel__import-line">in</span>
                                </button>
                              ))}
                            </div>
                          ))
                        ) : null}
                      </div>
                    ) : null}

                    {selectedFileConnectionGroups.imports.length === 0 && selectedFileConnectionGroups.importedBy.length === 0 ? (
                      <div className="metadata-panel__empty-line">No wires found.</div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <>
            <section
              className={`metadata-panel__section metadata-panel__pressure-section ${selectedFileHasPressure ? "is-active" : "is-quiet"}`.trim()}
              aria-label="Pressure"
            >
              <div className="metadata-panel__pressure-topline">
                <span className="metadata-panel__pressure-title">PRESSURE</span>
                <span
                  className="metadata-panel__pressure-indicator"
                  aria-label={`${selectedFileHasPressure ? selectedFilePressureRules.length : 0} pressure signals`}
                >
                  <span
                    className={[
                      "metadata-panel__pressure-dot",
                      selectedFileHasPressure ? "is-active" : "",
                      selectedFileHasPressure && selectedNode.healthTier === "critical" ? "is-critical" : "",
                      selectedFileHasPressure && selectedNode.healthTier === "warning" ? "is-warning" : ""
                    ].filter(Boolean).join(" ")}
                    aria-hidden="true"
                  />
                  <span className="metadata-panel__pressure-count">
                    {selectedFileHasPressure ? selectedFilePressureRules.length : 0}
                  </span>
                </span>
              </div>
              <button
                type="button"
                className="metadata-panel__pressure-analysis-button"
                disabled={!selectedFileHasPressure}
                onClick={enterMetadataForecast}
              >
                Pressure Analysis
              </button>
            </section>

            <CollapsibleMetadataSection
              id="structure"
              title="Structure"
              summary={`${selectedFileFunctionCount} functions / ${selectedNode.metadata?.importCount ?? 0} imports`}
              isCollapsed={collapsedFileSectionSet.has("structure")}
              onToggle={toggleFileMetadataSection}
            >
              <div className="metadata-panel__file-identity">
                <div className="metadata-panel__file-title-row">
                  <div className="metadata-panel__filename">{selectedNode.label}</div>
                  {selectedNode.metadata?.extension ? (
                    <span className="metadata-panel__ext-badge">{selectedNode.metadata.extension}</span>
                  ) : null}
                </div>
                <div className="metadata-panel__path">{parentDirectoryPath(selectedNode)}</div>
                {selectedNode.metadata?.staticEntrypoint ? (
                  <div className="metadata-panel__role-pill metadata-panel__role-pill--entrypoint">
                    <span className="metadata-panel__role-dot" />
                    <span>Confirmed static entrypoint</span>
                  </div>
                ) : null}
              </div>

              <div className="metadata-panel__actions">
                <button
                  type="button"
                  className="metadata-panel__button metadata-panel__button--primary"
                  onClick={() => {
                    setSourceModalInventoryMode(null);
                    setSourceModalFile(selectedNode);
                  }}
                >
                  Inspect Code
                </button>
                <button
                  type="button"
                  className="metadata-panel__switch-button metadata-panel__switch-button--wires"
                  onClick={openWiresPanel}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7c5 0 5 10 10 10h6" />
                    <path d="M4 17c4 0 5-10 10-10h6" />
                    <circle cx="4" cy="7" r="1.5" />
                    <circle cx="4" cy="17" r="1.5" />
                    <circle cx="20" cy="7" r="1.5" />
                    <circle cx="20" cy="17" r="1.5" />
                  </svg>
                  <span>Wires</span>
                </button>
              </div>

              <div className="metadata-panel__stats-grid">
                <div className="metadata-panel__stat">
                  <strong className={typeof selectedNode.metadata?.linesOfCode === "number" && selectedNode.metadata.linesOfCode === 0 ? "metadata-panel__stat-number metadata-panel__stat-number--zero" : "metadata-panel__stat-number"}>
                    {selectedNode.metadata?.linesOfCode ?? 0}
                  </strong>
                  <span>Lines</span>
                </div>
                <div className="metadata-panel__stat">
                  <strong className={selectedFileFunctionCount === 0 ? "metadata-panel__stat-number metadata-panel__stat-number--zero" : "metadata-panel__stat-number"}>
                    {selectedFileFunctionCount}
                  </strong>
                  <span>Functions</span>
                </div>
                <div className="metadata-panel__stat">
                  <strong className={Number(selectedNode.metadata?.importCount ?? 0) === 0 ? "metadata-panel__stat-number metadata-panel__stat-number--zero" : "metadata-panel__stat-number"}>
                    {selectedNode.metadata?.importCount ?? 0}
                  </strong>
                  <span>Imports</span>
                </div>
                <div className="metadata-panel__stat">
                  <strong className={importedByCount === 0 ? "metadata-panel__stat-number metadata-panel__stat-number--zero" : "metadata-panel__stat-number"}>
                    {importedByCount}
                  </strong>
                  <span>Imported by</span>
                </div>
              </div>

              <div className="metadata-panel__role-pill">
                <span className="metadata-panel__role-dot" />
                <span>{selectedFileRole?.label ?? "Support module"}</span>
              </div>
              <p className="metadata-panel__body-text">
                {selectedFileRole?.description ?? "This file keeps a modest dependency surface and mostly supports nearby nodes."}
              </p>
            </CollapsibleMetadataSection>

              </>
            )}
          </aside>
        ) : selectedRegionSummary ? (
          <aside className="metadata-panel operational-panel">
            <section className="operational-panel__identity operational-panel__anchor" aria-label="Identity and architectural weight">
              <div className="metadata-panel__type">{panelObjectType(selectedNode)}</div>
              <div className="operational-panel__title-row">
                <div className="metadata-panel__title">{panelTitle(selectedNode)}</div>
              </div>
              <div className="operational-panel__path">{orientationPath(selectedNode)}</div>
              <header className="operational-panel__header">
                <h3>Regional Density</h3>
              </header>
              <div className="operational-panel__metrics">
                <div><strong>{selectedRegionSummary.fileCount}</strong><span>Files</span></div>
                <div><strong>{selectedRegionSummary.folderCount}</strong><span>Folders</span></div>
                {typeof selectedRegionSummary.totalLinesOfCode === "number" ? (
                  <div><strong>{selectedRegionSummary.totalLinesOfCode}</strong><span>LOC</span></div>
                ) : null}
                {typeof selectedRegionSummary.totalFunctionCount === "number" ? (
                  <div><strong>{selectedRegionSummary.totalFunctionCount}</strong><span>Functions</span></div>
                ) : null}
              </div>
              <p className="operational-panel__basis">{selectedRegionSummary.directChildCount} direct items in this territory.</p>
            </section>

            <CollapsibleSemanticRegion
              title="File Types"
              summary={selectedRegionSummary.fileTypes.length > 0
                ? `${selectedRegionSummary.fileTypes.length} type${selectedRegionSummary.fileTypes.length === 1 ? "" : "s"} / ${selectedRegionSummary.fileCount} files`
                : "No indexed files"}
              isExpanded={activeSecondaryRegion === "file-types"}
              onToggle={() => toggleSecondaryRegion("file-types")}
            >
              {selectedRegionSummary.fileTypes.length > 0 ? (
                <ul className="operational-panel__file-types" aria-label="File counts by type">
                  {selectedRegionSummary.fileTypes.map((fileType) => (
                    <li key={fileType.label}>
                      <code>{fileType.label}</code>
                      <strong>{fileType.count}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="operational-panel__basis">No indexed files in this territory.</p>
              )}
            </CollapsibleSemanticRegion>
          </aside>
        ) : null
      ) : null}
      <PressureAnalysisWindow
        open={pressureAnalysisWindowOpen && selectedNode?.type === "file"}
        mode={forecastInspectionMode}
        fileName={selectedNode?.label ?? "No file selected"}
        filePath={selectedNode?.path}
        pressureSignalCount={selectedFileHasPressure ? selectedFilePressureRules.length : 0}
        pressureRules={selectedFilePressureRules}
        activePressureInvestigation={activePressureInvestigation}
        selectedPressureFunctionRows={selectedPressureFunctionRows}
        selectedPressureFunction={selectedPressureFunction}
        onInvestigateRule={investigatePressureRule}
        onBackToRules={() => setActivePressureInvestigation(null)}
        onSelectPressureFunctionId={setSelectedPressureFunctionId}
        onClose={() => setPressureAnalysisWindowOpen(false)}
      />
      {sourceModalFile ? (
        <Suspense fallback={<div className="source-modal__backdrop"><div className="source-modal__loading">Loading Raw Source</div></div>}>
          <SourceCodeModal
            file={sourceModalFile}
            sourceFiles={graph?.nodes.filter((node) => node.type === "file")}
            runtimeContext={sourceModalRuntimeContext}
            fileContext={sourceModalFileContext}
            inspectionMode={forecastInspectionMode}
            inventoryMode={sourceModalInventoryMode === "function-count"}
            inventoryFunctionCounts={sourceModalInventoryFunctionCounts}
            inventorySortExplanation={sourceModalInventoryMode === "function-count" ? "Function inventory opened from pressure analysis." : undefined}
            inventorySortMode={sourceModalInventoryMode === "function-count" ? "complex" : undefined}
            onClose={() => {
              setSourceModalFile(null);
              setSourceModalInventoryMode(null);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
