import type { AtlasNode } from "../api";
import type { SourceFunctionWaypoint } from "./sourceInspection";

type FileWaypoint = NonNullable<NonNullable<AtlasNode["metadata"]>["functionWaypoints"]>[number];

export interface ForecastBlock {
  title: string;
  items: string[];
}

export interface ForecastModel {
  available: boolean;
  subject: string;
  subtext: string;
  pressureSignals: string[];
  current: ForecastBlock;
  suggested: ForecastBlock[];
}

interface FileForecastContext {
  importedByCount?: number;
}

const emptyForecast: ForecastModel = {
  available: false,
  subject: "",
  subtext: "",
  pressureSignals: [],
  current: {
    title: "",
    items: []
  },
  suggested: []
};

function fileStem(file: AtlasNode): string {
  const lastDot = file.label.lastIndexOf(".");
  return lastDot > 0 ? file.label.slice(0, lastDot) : file.label;
}

function lowerSignalText(file: AtlasNode): string {
  const functionNames = (file.metadata?.functionWaypoints ?? []).map((waypoint) => waypoint.name).join("\n");
  return `${file.label}\n${file.path}\n${functionNames}\n${file.sourceText ?? ""}`.toLowerCase();
}

function crossFileCallCount(functions: FileWaypoint[]): number {
  return functions.reduce(
    (total, waypoint) => total + waypoint.calls.filter((call) => Boolean(call.definitionPath)).length,
    0
  );
}

function maxComplexity(functions: FileWaypoint[]): { cyclomatic: number; cognitive: number } {
  return functions.reduce(
    (maximum, waypoint) => ({
      cyclomatic: Math.max(maximum.cyclomatic, Number(waypoint.cyclomaticComplexity ?? 0)),
      cognitive: Math.max(maximum.cognitive, Number(waypoint.cognitiveComplexity ?? 0))
    }),
    { cyclomatic: 0, cognitive: 0 }
  );
}

function fileResponsibilities(file: AtlasNode): string[] {
  const functions = file.metadata?.functionWaypoints ?? [];
  const signalText = lowerSignalText(file);
  const responsibilities = new Set<string>();

  if (/\.(tsx|jsx)$/i.test(String(file.metadata?.extension ?? "")) || /<\/?[a-z][\w.-]*(\s|>|\/>)/i.test(file.sourceText ?? "")) {
    responsibilities.add("rendering");
  }

  if (/\b(runtime|corridor|trace|chain|flow|scrub|replay|execution|xray|x-ray)\b/.test(signalText)) {
    responsibilities.add("runtime flow");
  }

  if (functions.some((waypoint) => waypoint.stateUpdates.length > 0) || /\buse(?:State|Reducer)\s*\(/.test(file.sourceText ?? "")) {
    responsibilities.add("state changes");
  }

  if (/\b(normalize|resolve|build|compact|transform|project|group|map|filter|reduce|sort)\b/.test(signalText)) {
    responsibilities.add("data transforms");
  }

  if (Number(file.metadata?.importCount ?? 0) >= 8 || crossFileCallCount(functions) >= 5) {
    responsibilities.add("dependency routing");
  }

  if (responsibilities.size === 0) {
    responsibilities.add("local helper logic");
  }

  return [...responsibilities];
}

function pressureSignalsForFile(file: AtlasNode, importedByCount: number): string[] {
  const functions = file.metadata?.functionWaypoints ?? [];
  const responsibilities = fileResponsibilities(file);
  const complexity = maxComplexity(functions);
  const importCount = Number(file.metadata?.importCount ?? 0);
  const functionCount = Number(file.metadata?.functionCount ?? functions.length);
  const maxFunctionLines = functions.reduce(
    (maximum, waypoint) => Math.max(maximum, Math.max(0, waypoint.endLine - waypoint.startLine + 1)),
    0
  );
  const signals: string[] = [];

  if (file.healthTier === "critical" || (typeof file.healthScore === "number" && file.healthScore < 45)) {
    signals.push("Health Stress");
  } else if (file.healthTier === "warning" || (typeof file.healthScore === "number" && file.healthScore < 70)) {
    signals.push("Health Stress");
  }

  if (maxFunctionLines >= 60) {
    signals.push("Large Function");
  }

  if (complexity.cyclomatic >= 15 || complexity.cognitive >= 20) {
    signals.push("High Complexity");
  }

  if (responsibilities.length >= 3) {
    signals.push("Responsibility Overlap");
  }

  if (importCount >= 10 || importedByCount >= 8 || importCount + importedByCount >= 16) {
    signals.push("Dependency Concentration");
  }

  if (functionCount >= 25) {
    signals.push("Function Sprawl");
  }

  if (functions.some((waypoint) => waypoint.calls.length >= 10 || waypoint.stateUpdates.length >= 4)) {
    signals.push("Orchestration Hub");
  }

  return signals;
}

function suggestedBlocksForFile(file: AtlasNode, responsibilities: string[]): ForecastBlock[] {
  const stem = fileStem(file);
  const safeStem = stem.replace(/[^A-Za-z0-9]+/g, "");
  const normalizedStem = safeStem.length > 0 ? safeStem[0].toLowerCase() + safeStem.slice(1) : "file";
  const blocks: ForecastBlock[] = [{
    title: file.label,
    items: responsibilities.includes("rendering") ? ["rendering"] : ["main flow"]
  }];

  if (responsibilities.includes("runtime flow")) {
    blocks.push({
      title: `runtime/${normalizedStem}Runtime.ts`,
      items: ["runtime flow", "trace building"]
    });
  }

  if (responsibilities.includes("state changes")) {
    blocks.push({
      title: `hooks/use${safeStem || "File"}State.ts`,
      items: ["state changes"]
    });
  }

  if (responsibilities.includes("data transforms")) {
    blocks.push({
      title: `transforms/${normalizedStem}Transforms.ts`,
      items: ["data transforms", "small helpers"]
    });
  }

  if (responsibilities.includes("dependency routing")) {
    blocks.push({
      title: `relations/${normalizedStem}Relations.ts`,
      items: ["imports", "connection lookup"]
    });
  }

  if (blocks.length === 1) {
    blocks.push({
      title: `helpers/${normalizedStem}Helpers.ts`,
      items: ["small helper logic"]
    });
  }

  return blocks.slice(0, 5);
}

export function buildFileForecast(file: AtlasNode, context: FileForecastContext = {}): ForecastModel {
  if (file.type !== "file" || file.healthTier === "unscored") {
    return emptyForecast;
  }

  const importedByCount = Number(context.importedByCount ?? 0);
  const responsibilities = fileResponsibilities(file);
  const pressureSignals = pressureSignalsForFile(file, importedByCount);

  if (pressureSignals.length === 0) {
    return emptyForecast;
  }

  return {
    available: true,
    subject: file.label,
    subtext: responsibilities.length >= 3
      ? "This file is carrying several responsibilities."
      : "This file is collecting pressure from nearby work.",
    pressureSignals: pressureSignals.slice(0, 4),
    current: {
      title: file.label,
      items: responsibilities
    },
    suggested: suggestedBlocksForFile(file, responsibilities)
  };
}

function functionResponsibilityItems(waypoint: SourceFunctionWaypoint): string[] {
  const items = new Set<string>();

  for (const concern of waypoint.concerns) {
    if (concern === "runtime") {
      items.add("runtime flow");
    } else if (concern === "state") {
      items.add("state changes");
    } else if (concern === "transformation") {
      items.add("data transforms");
    } else if (concern === "rendering") {
      items.add("rendering");
    } else if (concern === "event") {
      items.add("user actions");
    }
  }

  if (waypoint.calls.length >= 5) {
    items.add("calls other functions");
  }

  if (waypoint.stateUpdates.length > 0) {
    items.add("updates state");
  }

  if (items.size === 0) {
    items.add("local helper logic");
  }

  return [...items];
}

function sourcePressureSignals(waypoint: SourceFunctionWaypoint): string[] {
  const complexity = Number(waypoint.cyclomaticComplexity ?? 0) + Number(waypoint.cognitiveComplexity ?? 0);
  const signals: string[] = [];

  if (waypoint.gravityLevel === "high" || waypoint.gravityScore >= 70) {
    signals.push("Orchestration Hub");
  }

  if (complexity >= 24 || Number(waypoint.cyclomaticComplexity ?? 0) >= 15 || Number(waypoint.cognitiveComplexity ?? 0) >= 20) {
    signals.push("High Complexity");
  }

  if (waypoint.concerns.length >= 3) {
    signals.push("Responsibility Overlap");
  }

  if (waypoint.calls.length >= 8) {
    signals.push("Dependency Concentration");
  }

  if (waypoint.stateUpdates.length >= 3) {
    signals.push("State Pressure");
  }

  return signals;
}

function suggestedBlocksForFunction(file: AtlasNode, waypoint: SourceFunctionWaypoint, items: string[]): ForecastBlock[] {
  const stem = fileStem(file).replace(/[^A-Za-z0-9]+/g, "");
  const functionStem = waypoint.name.replace(/[^A-Za-z0-9]+/g, "") || "focusedFunction";
  const lowerFunctionStem = functionStem[0].toLowerCase() + functionStem.slice(1);
  const blocks: ForecastBlock[] = [];

  if (items.includes("runtime flow")) {
    blocks.push({ title: `runtime/${lowerFunctionStem}Flow.ts`, items: ["runtime flow"] });
  }

  if (items.includes("calls other functions")) {
    blocks.push({ title: `runtime/${lowerFunctionStem}Traversal.ts`, items: ["calls", "walking related functions"] });
  }

  if (items.includes("state changes") || items.includes("updates state")) {
    blocks.push({ title: `hooks/use${stem || functionStem}State.ts`, items: ["state changes"] });
  }

  if (items.includes("data transforms")) {
    blocks.push({ title: `transforms/${lowerFunctionStem}Transforms.ts`, items: ["data transforms"] });
  }

  if (items.includes("rendering")) {
    blocks.push({ title: file.label, items: ["rendering only"] });
  }

  if (blocks.length === 0) {
    blocks.push({ title: `helpers/${lowerFunctionStem}.ts`, items: ["small helper logic"] });
  }

  return blocks.slice(0, 4);
}

export function buildFunctionForecast(file: AtlasNode, waypoint: SourceFunctionWaypoint | null): ForecastModel {
  if (!waypoint) {
    return emptyForecast;
  }

  const pressureSignals = sourcePressureSignals(waypoint);

  if (pressureSignals.length === 0) {
    return emptyForecast;
  }

  const currentItems = functionResponsibilityItems(waypoint);

  return {
    available: true,
    subject: `${waypoint.name}()`,
    subtext: currentItems.length >= 3
      ? "This function is carrying several jobs."
      : "This function is holding pressure inside the current file.",
    pressureSignals: pressureSignals.slice(0, 4),
    current: {
      title: `${waypoint.name}()`,
      items: currentItems
    },
    suggested: suggestedBlocksForFunction(file, waypoint, currentItems)
  };
}
