import {
  FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  analyzeRepo,
  getGitHubAuthStatus,
  githubConnectUrl,
  listSavedGraphs,
  loadSavedGraph,
  loadSharedGraph,
  loadGitHubRepositories,
  logoutGitHub,
  saveGraph,
  searchPublicGitHubRepositories,
  shareSavedGraph,
  type AtlasGraph,
  type AtlasNode,
  type GitHubAuthStatus,
  type GitHubRepository,
  type LoadedSavedGraph,
  type SavedGraphSummary,
  type SavedMapViewState
} from "./api";
import { clusteringOptions, type ClusteringMode } from "./graph/clustering";
import { GraphView } from "./graph/GraphView";

const SourceCodeModal = lazy(() =>
  import("./graph/SourceCodeModal").then((module) => ({ default: module.SourceCodeModal }))
);

type FunctionWaypoint = NonNullable<NonNullable<AtlasNode["metadata"]>["functionWaypoints"]>[number];
type FunctionCall = FunctionWaypoint["calls"][number];
type AppStyle = CSSProperties & Record<`--${string}`, string | number>;
type FunctionSortMode = "category" | "type" | "score" | "complexity" | "runtime" | "state" | "ghost";
type OperationalFunctionCategory =
  | "entry"
  | "state"
  | "runtime"
  | "transform"
  | "visual"
  | "complex"
  | "ghost";

interface FunctionStatusSummary {
  raw: number;
  runtime: number;
  ghost: number;
  functions: FunctionInventoryItem[];
}

interface FunctionInventoryItem {
  id: string;
  sourceFunctionId: string;
  fileId: string;
  fileLabel: string;
  filePath: string;
  label: string;
  kind: FunctionWaypoint["kind"];
  startLine: number;
  lineCount: number;
  cyclomatic: number;
  cognitive: number;
  score: number;
  runtime: boolean;
  ghost: boolean;
  exported: boolean;
  exportNames: string[];
  importance: number;
  tags: string[];
  purpose: string;
  observation: string;
  categories: OperationalFunctionCategory[];
  runtimeFunctionIds: Set<string>;
}

interface FunctionInventoryGroup {
  id: string;
  label: string;
  items: FunctionInventoryItem[];
}

function functionKey(filePath: string, waypoint: FunctionWaypoint, index: number): string {
  return `${filePath}:${waypoint.waypointId ?? `${waypoint.name}:${waypoint.startLine}:${waypoint.endLine}:${index}`}`;
}

function sourceFunctionId(waypoint: FunctionWaypoint, index: number): string {
  return waypoint.waypointId ?? `function-${index}-${waypoint.startLine}`;
}

function numericComplexity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function combinedFunctionComplexity(waypoint: FunctionWaypoint): number {
  return numericComplexity(waypoint.cyclomaticComplexity) + numericComplexity(waypoint.cognitiveComplexity) * 0.5;
}

function callTargetKey(
  call: FunctionCall,
  filesByPath: Map<string, AtlasNode>,
  functionKeysByFile: Map<string, Map<FunctionWaypoint, string>>
): string | null {
  if (!call.definitionPath) {
    return null;
  }

  const targetFile = filesByPath.get(call.definitionPath);
  const targetWaypoints = targetFile?.metadata?.functionWaypoints ?? [];
  const targetKeys = functionKeysByFile.get(call.definitionPath);

  if (!targetFile || !targetKeys) {
    return null;
  }

  const byId = call.definitionWaypointId
    ? targetWaypoints.find((waypoint) => waypoint.waypointId === call.definitionWaypointId)
    : undefined;

  if (byId) {
    return targetKeys.get(byId) ?? null;
  }

  const bySpan = call.definitionStartLine !== undefined && call.definitionEndLine !== undefined
    ? targetWaypoints.filter(
        (waypoint) =>
          waypoint.startLine === call.definitionStartLine &&
          waypoint.endLine === call.definitionEndLine
      )
    : [];

  if (bySpan.length === 1) {
    return targetKeys.get(bySpan[0]) ?? null;
  }

  const byName = call.definitionName
    ? targetWaypoints.filter((waypoint) => waypoint.name === call.definitionName)
    : [];

  return byName.length === 1 ? targetKeys.get(byName[0]) ?? null : null;
}

const FUNCTION_SORT_OPTIONS: Array<{ id: FunctionSortMode; label: string }> = [
  { id: "category", label: "Category" },
  { id: "type", label: "Type" },
  { id: "score", label: "Score" },
  { id: "complexity", label: "Complexity" },
  { id: "runtime", label: "Runtime" },
  { id: "state", label: "State" },
  { id: "ghost", label: "Ghost" }
];
const FUNCTION_SORT_EXPLANATIONS: Record<FunctionSortMode, string> = {
  category: "Groups functions by what they appear to do.",
  type: "Groups functions by their code shape.",
  score: "Shows functions that seem to matter most.",
  complexity: "Shows where the logic is largest.",
  runtime: "Shows functions involved in runtime paths.",
  state: "Shows functions that change app state.",
  ghost: "Shows functions with no clear caller."
};
const OPERATIONAL_FUNCTION_GROUPS: Array<{ id: OperationalFunctionCategory; label: string }> = [
  { id: "entry", label: "ENTRY / MAIN FLOW" },
  { id: "state", label: "STATE CHANGES" },
  { id: "runtime", label: "RUNTIME FLOW" },
  { id: "transform", label: "DATA HELPERS" },
  { id: "visual", label: "VISUAL RENDERING" },
  { id: "complex", label: "HIGH COMPLEXITY" },
  { id: "ghost", label: "GHOST / UNRESOLVED" }
];
const FUNCTION_PANEL_MIN_WIDTH = 280;
const FUNCTION_PANEL_MAX_WIDTH = 560;
const FUNCTION_PANEL_INITIAL_WIDTH = 380;

function clampFunctionPanelWidth(width: number): number {
  return Math.max(FUNCTION_PANEL_MIN_WIDTH, Math.min(FUNCTION_PANEL_MAX_WIDTH, width));
}

function uniqueFunctionCategories(categories: OperationalFunctionCategory[]): OperationalFunctionCategory[] {
  return [...new Set(categories)];
}

function categoriesForFunction(waypoint: FunctionWaypoint, runtime: boolean, score: number): OperationalFunctionCategory[] {
  const name = waypoint.name;
  const categories: OperationalFunctionCategory[] = [];
  const callNames = waypoint.calls.map((call) => call.name).join(" ");
  const hasRenderingSignal =
    waypoint.calls.some((call) => call.connectionKind === "jsx-render") ||
    /(?:render|view|panel|modal|node|edge|style|palette|layout|map|graph|component)/i.test(`${name} ${callNames}`);
  const hasRuntimeSignal = /(?:runtime|execution|trace|chain|corridor|scrub|replay|playback|resolve.*path|xray|x-ray)/i.test(`${name} ${callNames}`);
  const hasTransformSignal =
    /^(?:normalize|compact|format|parse|map|filter|sort|group|build|compute|derive|extract|summarize|classify|compare)/i.test(name) ||
    /\.(?:map|filter|reduce|sort|flatMap|fromEntries|entries)\b/.test(callNames);

  if (waypoint.exported || (waypoint.exportNames?.length ?? 0) > 0 || /^(?:App|main|bootstrap|init|GraphView|.*View)$/.test(name)) {
    categories.push("entry");
  }

  if (waypoint.stateUpdates.length > 0 || /^(?:set|sync|update|toggle|mutate|reset|clear|record)/i.test(name)) {
    categories.push("state");
  }

  if (runtime && hasRuntimeSignal) {
    categories.push("runtime");
  }

  if (hasTransformSignal && waypoint.stateUpdates.length === 0 && !hasRenderingSignal && !hasRuntimeSignal) {
    categories.push("transform");
  }

  if (hasRenderingSignal) {
    categories.push("visual");
  }

  if (numericComplexity(waypoint.cyclomaticComplexity) >= 15 || numericComplexity(waypoint.cognitiveComplexity) >= 20 || score >= 18) {
    categories.push("complex");
  }

  if (!runtime && !waypoint.exported && !waypoint.public && waypoint.stateUpdates.length === 0) {
    categories.push("ghost");
  }

  return uniqueFunctionCategories(categories.length > 0 ? categories : ["transform"]);
}

function functionImportance(waypoint: FunctionWaypoint, runtime: boolean, exported: boolean, score: number): number {
  return Math.round(
    Math.min(
      100,
      score * 2 +
        waypoint.calls.length * 4 +
        waypoint.stateUpdates.length * 8 +
        (runtime ? 18 : 0) +
        (exported ? 14 : 0)
    )
  );
}

function functionTags(
  waypoint: FunctionWaypoint,
  categories: OperationalFunctionCategory[],
  runtime: boolean,
  ghost: boolean,
  exported: boolean
): string[] {
  const tags = new Set<string>();

  if (categories.includes("entry")) tags.add("ENTRY");
  if (runtime) tags.add("RUNTIME");
  if (exported) tags.add("EXPORT");
  if (categories.includes("state")) tags.add("STATE");
  if (categories.includes("transform") && waypoint.stateUpdates.length === 0) tags.add("PURE");
  if (categories.includes("visual")) tags.add("VISUAL");
  if (ghost) tags.add("GHOST");

  return [...tags].slice(0, 5);
}

function functionPurpose(
  waypoint: FunctionWaypoint,
  item: Pick<FunctionInventoryItem, "categories" | "runtime" | "exported" | "fileLabel">
): string {
  const name = waypoint.name;

  if (name === "App") {
    return "Starts the app shell and connects the main screens.";
  }

  if (name === "GraphView") {
    return "Controls the main graph screen and user interactions.";
  }

  if (/source|modal|inspector/i.test(`${name} ${item.fileLabel}`)) {
    return "Shows source code inside the Atlas inspector.";
  }

  if (item.categories.includes("runtime")) {
    return "Builds or shows the runtime path used by Runtime View.";
  }

  if (item.categories.includes("state")) {
    return "Changes app state after user actions or loaded data.";
  }

  if (item.categories.includes("visual")) {
    return "Draws part of the screen or prepares visual details.";
  }

  if (item.categories.includes("entry") || item.exported) {
    return "Gives other parts of the app a clear place to start.";
  }

  if (item.categories.includes("transform")) {
    return "Prepares data so other parts of the app can use it.";
  }

  if (item.categories.includes("ghost")) {
    return "Exists in the code, but no clear caller was found.";
  }

  return "Supports nearby code with a focused job.";
}

function functionObservation(item: Pick<FunctionInventoryItem, "importance" | "score" | "runtime" | "ghost" | "categories" | "cyclomatic" | "cognitive">): string {
  if (item.ghost) {
    return "This function has no clear caller, so its role is uncertain.";
  }

  if (item.importance >= 70) {
    return "This function controls many parts of the app. Changes here can affect other systems.";
  }

  if (item.score >= 18 || item.cyclomatic >= 15 || item.cognitive >= 20) {
    return "This function is large and handles several jobs.";
  }

  if (item.runtime) {
    return "This function is part of a path the app follows while running.";
  }

  if (item.categories.includes("state")) {
    return "This function changes what the user sees or what the app remembers.";
  }

  if (item.categories.includes("transform")) {
    return "This function mostly prepares data for other parts of the app.";
  }

  return "This function has a narrow job and is easier to reason about.";
}

function functionPressureClass(item: FunctionInventoryItem): string {
  if (item.ghost) {
    return "is-uncertain";
  }

  if (item.importance >= 70 || item.score >= 18) {
    return "is-high-pressure";
  }

  if (item.importance >= 35 || item.score >= 8) {
    return "is-medium-pressure";
  }

  return "is-low-pressure";
}

function tagClassName(tag: string): string {
  return `is-${tag.toLowerCase()}`;
}

function sharedMapTokenFromPathname(pathname: string): string | null {
  const match = /^\/share\/([^/?#]+)/.exec(pathname);

  return match ? decodeURIComponent(match[1]) : null;
}

function shareUrlForToken(token: string): string {
  return `${window.location.origin}/share/${encodeURIComponent(token)}`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to a temporary textarea for browsers that block clipboard writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function summarizeFunctions(graph: AtlasGraph | null): FunctionStatusSummary | null {
  if (!graph) {
    return null;
  }

  const sourceFiles = graph.nodes.filter(
    (node) => node.type === "file" && (node.metadata?.functionWaypoints || typeof node.metadata?.functionCount === "number")
  );
  const filesByPath = new Map(sourceFiles.map((file) => [file.path, file]));
  const functionKeysByFile = new Map<string, Map<FunctionWaypoint, string>>();
  const filePathByFunctionKey = new Map<string, string>();
  const sourceIdByFunctionKey = new Map<string, string>();
  const fileByFunctionKey = new Map<string, AtlasNode>();
  const trackedFunctions: Array<{ waypoint: FunctionWaypoint; key: string; file: AtlasNode; sourceFunctionId: string }> = [];
  let raw = 0;

  for (const file of sourceFiles) {
    const waypoints = file.metadata?.functionWaypoints ?? [];
    const rawCount = Math.max(waypoints.length, Number(file.metadata?.functionCount ?? 0));
    raw += rawCount;

    const keys = new Map<FunctionWaypoint, string>();
    waypoints.forEach((waypoint, index) => {
      const key = functionKey(file.path, waypoint, index);
      const sourceId = sourceFunctionId(waypoint, index);
      keys.set(waypoint, key);
      filePathByFunctionKey.set(key, file.path);
      sourceIdByFunctionKey.set(key, sourceId);
      fileByFunctionKey.set(key, file);
      trackedFunctions.push({ waypoint, key, file, sourceFunctionId: sourceId });
    });
    functionKeysByFile.set(file.path, keys);
  }

  const runtimeKeys = new Set<string>();

  for (const { waypoint, key } of trackedFunctions) {
    for (const call of waypoint.calls) {
      const targetKey = callTargetKey(call, filesByPath, functionKeysByFile);

      if (targetKey) {
        runtimeKeys.add(key);
        runtimeKeys.add(targetKey);
      }
    }
  }

  for (const file of sourceFiles) {
    for (const call of file.metadata?.moduleLinks ?? []) {
      const targetKey = callTargetKey(call, filesByPath, functionKeysByFile);

      if (targetKey) {
        runtimeKeys.add(targetKey);
      }
    }
  }

  const runtimeFunctionIdsByFilePath = new Map<string, Set<string>>();

  for (const key of runtimeKeys) {
    const filePath = filePathByFunctionKey.get(key);
    const sourceId = sourceIdByFunctionKey.get(key);

    if (filePath && sourceId) {
      const ids = runtimeFunctionIdsByFilePath.get(filePath) ?? new Set<string>();
      ids.add(sourceId);
      runtimeFunctionIdsByFilePath.set(filePath, ids);
    }
  }

  const functions = trackedFunctions.map(({ waypoint, key, file, sourceFunctionId }): FunctionInventoryItem => {
    const runtime = runtimeKeys.has(key);
    const score = combinedFunctionComplexity(waypoint);
    const ghost = !runtime && !waypoint.exported && !waypoint.public && waypoint.stateUpdates.length === 0;
    const exported = Boolean(waypoint.exported || waypoint.public);
    const categories = categoriesForFunction(waypoint, runtime, score);
    const importance = functionImportance(waypoint, runtime, exported, score);
    const baseItem = {
      categories,
      runtime,
      exported,
      fileLabel: file.label,
      importance,
      score,
      ghost,
      cyclomatic: numericComplexity(waypoint.cyclomaticComplexity),
      cognitive: numericComplexity(waypoint.cognitiveComplexity)
    };

    return {
      id: key,
      sourceFunctionId,
      fileId: file.id,
      fileLabel: file.label,
      filePath: file.path,
      label: waypoint.name,
      kind: waypoint.kind,
      startLine: waypoint.startLine,
      lineCount: Math.max(1, waypoint.endLine - waypoint.startLine + 1),
      cyclomatic: baseItem.cyclomatic,
      cognitive: baseItem.cognitive,
      score,
      runtime,
      ghost,
      exported,
      exportNames: waypoint.exportNames ?? [],
      importance,
      tags: functionTags(waypoint, categories, runtime, ghost, exported),
      purpose: functionPurpose(waypoint, baseItem),
      observation: functionObservation(baseItem),
      categories,
      runtimeFunctionIds: runtimeFunctionIdsByFilePath.get(file.path) ?? new Set<string>()
    };
  });

  return {
    raw,
    runtime: runtimeKeys.size,
    ghost: Math.max(0, raw - runtimeKeys.size),
    functions
  };
}

function compareFunctionInventoryItems(left: FunctionInventoryItem, right: FunctionInventoryItem): number {
  return right.importance - left.importance ||
    right.score - left.score ||
    right.cyclomatic - left.cyclomatic ||
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.label.localeCompare(right.label);
}

function compareFunctionComplexity(left: FunctionInventoryItem, right: FunctionInventoryItem): number {
  return right.score - left.score ||
    right.cyclomatic - left.cyclomatic ||
    right.cognitive - left.cognitive ||
    right.importance - left.importance ||
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.label.localeCompare(right.label);
}

function groupedFunctionInventory(functions: FunctionInventoryItem[], sortMode: FunctionSortMode): FunctionInventoryGroup[] {
  if (sortMode === "category") {
    return OPERATIONAL_FUNCTION_GROUPS.flatMap((group) => {
      const items = functions
        .filter((item) => item.categories.includes(group.id))
        .sort(compareFunctionInventoryItems);

      return items.length > 0 ? [{ id: group.id, label: group.label, items }] : [];
    });
  }

  if (sortMode === "type") {
    const labels: Record<FunctionInventoryItem["kind"], string> = {
      function: "FUNCTIONS",
      arrow: "ARROW FUNCTIONS",
      method: "METHODS",
      accessor: "ACCESSORS",
      constructor: "CONSTRUCTORS",
      effect: "EFFECTS"
    };
    const groups = new Map<string, FunctionInventoryItem[]>();

    for (const item of functions) {
      const label = labels[item.kind] ?? item.kind.toUpperCase();
      groups.set(label, [...(groups.get(label) ?? []), item]);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, items]) => ({
        id: `type:${label}`,
        label,
        items: items.sort(compareFunctionInventoryItems)
      }));
  }

  if (sortMode === "complexity") {
    const complexityGroups: FunctionInventoryGroup[] = [
      {
        id: "complexity:high",
        label: "HIGH COMPLEXITY",
        items: functions.filter((item) => item.score >= 18 || item.cyclomatic >= 15 || item.cognitive >= 20).sort(compareFunctionComplexity)
      },
      {
        id: "complexity:medium",
        label: "MEDIUM COMPLEXITY",
        items: functions.filter((item) => item.score < 18 && item.score >= 8).sort(compareFunctionComplexity)
      },
      {
        id: "complexity:low",
        label: "LOW COMPLEXITY",
        items: functions.filter((item) => item.score < 8).sort(compareFunctionComplexity)
      }
    ];

    return complexityGroups.filter((group) => group.items.length > 0);
  }

  if (sortMode === "runtime") {
    return [
      {
        id: "runtime:yes",
        label: "IN RUNTIME FLOW",
        items: functions.filter((item) => item.runtime).sort(compareFunctionInventoryItems)
      },
      {
        id: "runtime:no",
        label: "NOT IN RUNTIME FLOW",
        items: functions.filter((item) => !item.runtime).sort(compareFunctionInventoryItems)
      }
    ].filter((group) => group.items.length > 0);
  }

  if (sortMode === "state") {
    return [
      {
        id: "state:yes",
        label: "CHANGES STATE",
        items: functions.filter((item) => item.categories.includes("state")).sort(compareFunctionInventoryItems)
      },
      {
        id: "state:no",
        label: "DOES NOT CHANGE STATE",
        items: functions.filter((item) => !item.categories.includes("state")).sort(compareFunctionInventoryItems)
      }
    ].filter((group) => group.items.length > 0);
  }

  if (sortMode === "ghost") {
    return [
      {
        id: "ghost:yes",
        label: "GHOST / UNRESOLVED",
        items: functions.filter((item) => item.ghost).sort(compareFunctionInventoryItems)
      },
      {
        id: "ghost:no",
        label: "HAS A CLEAR ROLE",
        items: functions.filter((item) => !item.ghost).sort(compareFunctionInventoryItems)
      }
    ].filter((group) => group.items.length > 0);
  }

  const scoreGroups: FunctionInventoryGroup[] = [
    {
      id: "score:high",
      label: "MOST IMPORTANT",
      items: functions.filter((item) => item.importance >= 70).sort(compareFunctionInventoryItems)
    },
    {
      id: "score:medium",
      label: "WATCH CLOSELY",
      items: functions.filter((item) => item.importance < 70 && item.importance >= 35).sort(compareFunctionInventoryItems)
    },
    {
      id: "score:low",
      label: "LOW PRESSURE",
      items: functions.filter((item) => item.importance < 35).sort(compareFunctionInventoryItems)
    }
  ];

  return scoreGroups.filter((group) => group.items.length > 0);
}

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [publicSearchOpen, setPublicSearchOpen] = useState(false);
  const [publicSearchQuery, setPublicSearchQuery] = useState("");
  const [publicSearchLoading, setPublicSearchLoading] = useState(false);
  const [publicSearchError, setPublicSearchError] = useState<string | null>(null);
  const [publicSearchResults, setPublicSearchResults] = useState<GitHubRepository[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [currentGraphRepoUrl, setCurrentGraphRepoUrl] = useState("");
  const [clusteringMode, setClusteringMode] = useState<ClusteringMode>("structural");
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeElapsedMs, setAnalyzeElapsedMs] = useState(0);
  const [lastAnalyzeTiming, setLastAnalyzeTiming] = useState<AtlasGraph["analyzeTiming"]>();
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus>({
    configured: false,
    connected: false,
    user: null
  });
  const [githubQuery, setGithubQuery] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [selectedGitHubRepoUrl, setSelectedGitHubRepoUrl] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [savedGraphs, setSavedGraphs] = useState<SavedGraphSummary[]>([]);
  const [selectedSavedGraphId, setSelectedSavedGraphId] = useState("");
  const [savedGraphsLoading, setSavedGraphsLoading] = useState(false);
  const [savedGraphsError, setSavedGraphsError] = useState<string | null>(null);
  const [isSavingGraph, setIsSavingGraph] = useState(false);
  const [isLoadingSavedGraph, setIsLoadingSavedGraph] = useState(false);
  const [isSharingGraph, setIsSharingGraph] = useState(false);
  const [isLoadingSharedGraph, setIsLoadingSharedGraph] = useState(false);
  const [saveMapName, setSaveMapName] = useState("");
  const [currentGraphViewState, setCurrentGraphViewState] = useState<SavedMapViewState | null>(null);
  const [restoreGraphViewState, setRestoreGraphViewState] = useState<SavedMapViewState | null>(null);
  const [restoreGraphViewStateKey, setRestoreGraphViewStateKey] = useState<string | null>(null);
  const [functionModalOpen, setFunctionModalOpen] = useState(false);
  const [functionSummaryExpanded, setFunctionSummaryExpanded] = useState(false);
  const [saveLoadExpanded, setSaveLoadExpanded] = useState(false);
  const [functionSortMode, setFunctionSortMode] = useState<FunctionSortMode>("category");
  const [selectedFunctionId, setSelectedFunctionId] = useState<string | null>(null);
  const [collapsedFunctionInventoryGroups, setCollapsedFunctionInventoryGroups] = useState<string[]>([]);
  const [functionPanelWidth, setFunctionPanelWidth] = useState(FUNCTION_PANEL_INITIAL_WIDTH);
  const [isFunctionPanelResizing, setIsFunctionPanelResizing] = useState(false);
  const functionPanelResizeOriginRef = useRef<{ pointerX: number; width: number } | null>(null);
  const functionStatusSummary = useMemo(() => summarizeFunctions(graph), [graph]);
  const functionInventoryGroups = useMemo(
    () => groupedFunctionInventory(functionStatusSummary?.functions ?? [], functionSortMode),
    [functionSortMode, functionStatusSummary]
  );
  const selectedFunction = useMemo(
    () => functionStatusSummary?.functions.find((item) => item.id === selectedFunctionId) ?? null,
    [functionStatusSummary, selectedFunctionId]
  );
  const selectedFunctionFile = useMemo(
    () => selectedFunction
      ? graph?.nodes.find((node) => node.id === selectedFunction.fileId && node.type === "file") ?? null
      : null,
    [graph?.nodes, selectedFunction]
  );
  const collapsedFunctionInventoryGroupSet = useMemo(
    () => new Set(collapsedFunctionInventoryGroups),
    [collapsedFunctionInventoryGroups]
  );
  const handleGraphViewStateChange = useCallback((viewState: SavedMapViewState | null) => {
    setCurrentGraphViewState(viewState);
  }, []);

  function applyLoadedGraph(result: LoadedSavedGraph, restoreKey: string): void {
    setGraph(result.graph);
    setCurrentGraphRepoUrl(result.savedGraph.repoUrl);
    setRepoUrl(result.savedGraph.repoUrl);
    setLastAnalyzeTiming(result.graph.analyzeTiming);
    setCurrentGraphViewState(result.viewState);
    setRestoreGraphViewState(result.viewState);
    setRestoreGraphViewStateKey(restoreKey);

    if (result.viewState?.clusteringMode && clusteringOptions.some((option) => option.id === result.viewState?.clusteringMode)) {
      setClusteringMode(result.viewState.clusteringMode as ClusteringMode);
    }

    setSaveMapName(result.savedGraph.saveName);
  }

  function compactUpdatedAt(isoDate?: string | null): string {
    if (!isoDate) {
      return "Unknown update";
    }

    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return "Unknown update";
    }

    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(date);
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = ms / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }

  function estimateAnalyzeDuration(repository: GitHubRepository): number {
    const stars = repository.stargazersCount ?? 0;
    const topicFactor = Math.min(8, repository.topics?.length ?? 0) * 2200;
    const starFactor = Math.min(180000, Math.log10(stars + 10) * 26000);
    const baseMs = 22000;
    return Math.round(baseMs + starFactor + topicFactor);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubResult = params.get("github");

    if (githubResult === "connected") {
      setStatus("GitHub connected");
    } else if (githubResult === "failed") {
      setError("GitHub connection failed.");
      setStatus("GitHub connection failed");
    }

    if (githubResult) {
      params.delete("github");
      const nextQuery = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
    }
  }, []);

  useEffect(() => {
    const shareToken = sharedMapTokenFromPathname(window.location.pathname);

    if (!shareToken) {
      return;
    }

    let cancelled = false;
    setIsLoadingSharedGraph(true);
    setError(null);
    setSavedGraphsError(null);
    setStatus("Opening shared map...");

    loadSharedGraph(shareToken)
      .then((result) => {
        if (cancelled) {
          return;
        }

        applyLoadedGraph(result, `share:${shareToken}:${result.savedGraph.updatedAt}`);
        setSelectedSavedGraphId("");
        setStatus(`${result.savedGraph.saveName} opened from shared link`);
      })
      .catch((caughtError) => {
        if (!cancelled) {
          const message = caughtError instanceof Error ? caughtError.message : "Failed to open shared map.";
          setError(message);
          setStatus("Shared map open failed");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSharedGraph(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshGitHubStatus() {
      try {
        const nextStatus = await getGitHubAuthStatus();

        if (!cancelled) {
          setGithubStatus(nextStatus);
          if (!nextStatus.connected) {
            setSelectedGitHubRepoUrl("");
          }
        }
      } catch {
        if (!cancelled) {
          setGithubStatus((current) => ({ ...current, connected: false, user: null }));
          setGithubError("GitHub connection status unavailable.");
        }
      }
    }

    void refreshGitHubStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!githubStatus.connected) {
      setGithubRepos([]);
      setGithubLoading(false);
      return;
    }

    setGithubLoading(true);
    setGithubError(null);

    const timer = window.setTimeout(() => {
      loadGitHubRepositories(githubQuery)
        .then((repositories) => {
          if (!cancelled) {
            setGithubRepos(repositories);
            setSelectedGitHubRepoUrl((current) =>
              current && repositories.some((repository) => repository.htmlUrl === current)
                ? current
                : repositories[0]?.htmlUrl ?? ""
            );
          }
        })
        .catch((caughtError) => {
          if (!cancelled) {
            const message = caughtError instanceof Error ? caughtError.message : "Failed to load GitHub repositories.";
            setGithubError(message);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setGithubLoading(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [githubQuery, githubStatus.connected]);

  useEffect(() => {
    let cancelled = false;

    if (!githubStatus.connected) {
      setSavedGraphs([]);
      setSelectedSavedGraphId("");
      setSavedGraphsLoading(false);
      setSavedGraphsError(null);
      return;
    }

    setSavedGraphsLoading(true);
    setSavedGraphsError(null);

    listSavedGraphs()
      .then((graphs) => {
        if (cancelled) {
          return;
        }

        setSavedGraphs(graphs);
        setSelectedSavedGraphId((current) =>
          current && graphs.some((savedGraph) => savedGraph.id === current)
            ? current
            : graphs[0]?.id ?? ""
        );
      })
      .catch((caughtError) => {
        if (!cancelled) {
          const message = caughtError instanceof Error ? caughtError.message : "Failed to load saved maps.";
          setSavedGraphsError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSavedGraphsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [githubStatus.connected, githubStatus.user?.id]);

  async function runAnalysis(targetRepoUrl: string, label = targetRepoUrl) {
    setError(null);
    setStatus(`Cloning and extracting ${label}...`);
    setIsAnalyzing(true);
    setAnalyzeElapsedMs(0);
    setLastAnalyzeTiming(undefined);

    try {
      const result = await analyzeRepo(targetRepoUrl);
      setGraph(result);
      setCurrentGraphRepoUrl(targetRepoUrl);
      setSelectedSavedGraphId("");
      setCurrentGraphViewState(null);
      setRestoreGraphViewState(null);
      setRestoreGraphViewStateKey(null);
      setSaveMapName("");
      setLastAnalyzeTiming(result.analyzeTiming);
      setStatus(`${result.nodes.length} nodes, ${result.edges.length} imports, ${result.commits?.length ?? 0} commits`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Analysis failed.";
      setError(message);
      setStatus("Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleAnalyzeExampleRepo(targetRepoUrl: string, label: string) {
    setRepoUrl(targetRepoUrl);
    void runAnalysis(targetRepoUrl, label);
  }

  function handleAnalyzeRepoUrl(targetRepoUrl: string) {
    const trimmed = targetRepoUrl.trim();
    if (!trimmed) {
      return;
    }

    setRepoUrl(trimmed);
    void runAnalysis(trimmed);
  }

  useEffect(() => {
    if (!isAnalyzing) {
      return;
    }

    const timer = window.setInterval(() => {
      setAnalyzeElapsedMs((current) => current + 250);
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [isAnalyzing]);

  function handleConnectGitHub() {
    window.location.href = githubConnectUrl();
  }

  async function handleLogoutGitHub() {
    try {
      await logoutGitHub();
      setGithubStatus({ configured: githubStatus.configured, connected: false, user: null });
      setGraph(null);
      setCurrentGraphRepoUrl("");
      setGithubRepos([]);
      setGithubQuery("");
      setSavedGraphs([]);
      setSelectedSavedGraphId("");
      setSavedGraphsError(null);
      setSaveMapName("");
      setCurrentGraphViewState(null);
      setRestoreGraphViewState(null);
      setRestoreGraphViewStateKey(null);
      setStatus("GitHub disconnected");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to disconnect GitHub.";
      setGithubError(message);
    }
  }

  async function handleGitHubRepoAnalyze(repository: GitHubRepository) {
    setSelectedGitHubRepoUrl(repository.htmlUrl);
    await runAnalysis(repository.htmlUrl, repository.fullName);
  }

  async function handleGitHubSelectorAnalyze() {
    const repository = githubRepos.find((repo) => repo.htmlUrl === selectedGitHubRepoUrl);

    if (!repository) {
      return;
    }

    await handleGitHubRepoAnalyze(repository);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      return;
    }
    await runAnalysis(trimmed);
  }

  async function handleSaveCurrentGraph() {
    if (!graph || !currentGraphRepoUrl) {
      return;
    }

    const trimmedSaveName = saveMapName.trim();
    if (!trimmedSaveName) {
      setSavedGraphsError("Type a save name first.");
      return;
    }

    setIsSavingGraph(true);
    setSavedGraphsError(null);

    try {
      const savedGraph = await saveGraph(currentGraphRepoUrl, trimmedSaveName, graph, currentGraphViewState);
      setSavedGraphs((current) => [
        savedGraph,
        ...current.filter((candidate) => candidate.id !== savedGraph.id)
      ]);
      setSelectedSavedGraphId(savedGraph.id);
      setStatus(`Saved map: ${savedGraph.saveName}`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to save map.";
      setSavedGraphsError(message);
    } finally {
      setIsSavingGraph(false);
    }
  }

  async function handleOpenSavedGraph() {
    if (!selectedSavedGraphId) {
      return;
    }

    setIsLoadingSavedGraph(true);
    setSavedGraphsError(null);
    setError(null);
    setStatus("Opening saved map...");

    try {
      const result = await loadSavedGraph(selectedSavedGraphId);
      applyLoadedGraph(result, `${result.savedGraph.id}:${result.savedGraph.updatedAt}`);
      setSavedGraphs((current) => [
        result.savedGraph,
        ...current.filter((candidate) => candidate.id !== result.savedGraph.id)
      ]);
      setStatus(`${result.savedGraph.saveName} opened from saved map`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to open saved map.";
      setSavedGraphsError(message);
      setStatus("Saved map open failed");
    } finally {
      setIsLoadingSavedGraph(false);
    }
  }

  async function handleCopyShareLink() {
    if (!selectedSavedGraphId) {
      return;
    }

    setIsSharingGraph(true);
    setSavedGraphsError(null);

    try {
      const sharedGraph = await shareSavedGraph(selectedSavedGraphId);

      if (!sharedGraph.shareToken) {
        throw new Error("Share link was not created.");
      }

      await copyTextToClipboard(shareUrlForToken(sharedGraph.shareToken));
      setSavedGraphs((current) =>
        current.map((candidate) => candidate.id === sharedGraph.id ? sharedGraph : candidate)
      );
      setStatus(`Share link copied: ${sharedGraph.saveName}`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to copy share link.";
      setSavedGraphsError(message);
      setStatus("Share link failed");
    } finally {
      setIsSharingGraph(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (!publicSearchOpen) {
      return;
    }

    const query = publicSearchQuery.trim();
    if (query.length < 2) {
      setPublicSearchResults([]);
      setPublicSearchLoading(false);
      setPublicSearchError(null);
      return;
    }

    setPublicSearchLoading(true);
    setPublicSearchError(null);

    const timer = window.setTimeout(() => {
      searchPublicGitHubRepositories(query)
        .then((repositories) => {
          if (!cancelled) {
            setPublicSearchResults(repositories);
          }
        })
        .catch((caughtError) => {
          if (!cancelled) {
            const message = caughtError instanceof Error ? caughtError.message : "Failed to search public repositories.";
            setPublicSearchError(message);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPublicSearchLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [publicSearchOpen, publicSearchQuery]);

  useEffect(() => {
    if (!isFunctionPanelResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    function handlePointerMove(event: PointerEvent): void {
      const origin = functionPanelResizeOriginRef.current;

      if (origin) {
        setFunctionPanelWidth(clampFunctionPanelWidth(origin.width + event.clientX - origin.pointerX));
      }
    }

    function endResize(): void {
      functionPanelResizeOriginRef.current = null;
      setIsFunctionPanelResizing(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
    };
  }, [isFunctionPanelResizing]);

  function openFunctionInventory(): void {
    setSelectedFunctionId((current) =>
      current && functionStatusSummary?.functions.some((item) => item.id === current)
        ? current
        : functionInventoryGroups[0]?.items[0]?.id ?? functionStatusSummary?.functions[0]?.id ?? null
    );
    setFunctionModalOpen(true);
  }

  function closeFunctionInventory(): void {
    setFunctionModalOpen(false);
    setIsFunctionPanelResizing(false);
    functionPanelResizeOriginRef.current = null;
  }

  function toggleFunctionInventoryGroup(groupId: string): void {
    setCollapsedFunctionInventoryGroups((current) =>
      current.includes(groupId)
        ? current.filter((candidate) => candidate !== groupId)
        : [...current, groupId]
    );
  }

  function beginFunctionPanelResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    functionPanelResizeOriginRef.current = {
      pointerX: event.clientX,
      width: functionPanelWidth
    };
    setIsFunctionPanelResizing(true);
  }

  function resizeFunctionPanelWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const increment = event.shiftKey ? 40 : 12;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setFunctionPanelWidth((width) => clampFunctionPanelWidth(width - increment));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setFunctionPanelWidth((width) => clampFunctionPanelWidth(width + increment));
    } else if (event.key === "Home") {
      event.preventDefault();
      setFunctionPanelWidth(FUNCTION_PANEL_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setFunctionPanelWidth(FUNCTION_PANEL_MAX_WIDTH);
    }
  }

  async function handleAnalyzePublicRepository(repository: GitHubRepository) {
    setPublicSearchOpen(false);
    await runAnalysis(repository.htmlUrl, repository.fullName);
  }

  const showWorkflowChrome = graph !== null || githubStatus.connected;

  return (
    <main className="app">
      {showWorkflowChrome ? (
        <header className="topbar">
          <div className="brand">
            <span className="brand__mark">CA</span>
            <div>
              <h1>Code Atlas</h1>
              <p>for JavaScript and Python ecosystems</p>
              <p className="brand__subtitle">Deterministic repository structure graph</p>
            </div>
          </div>

          <div className="repo-entry">
            <div className="repo-entry__primary">
              <button
                type="button"
                className="public-search-trigger"
                onClick={() => setPublicSearchOpen(true)}
                disabled={isAnalyzing}
              >
                Search Public Repos
              </button>

              {githubStatus.connected ? (
                <section className="github-repo-panel" aria-label="Connected GitHub repositories">
                  <div className="github-repo-panel__header">
                    <span>GitHub: <strong>@{githubStatus.user?.login}</strong></span>
                    <button type="button" onClick={handleLogoutGitHub}>Disconnect</button>
                  </div>
                  <div className="github-repo-panel__selector">
                    <input
                      className="github-repo-panel__search"
                      value={githubQuery}
                      onChange={(event) => setGithubQuery(event.target.value)}
                      placeholder="Search connected repos"
                      aria-label="Search connected GitHub repositories"
                    />
                    <div className="atlas-select">
                      <select
                        aria-label="Connected repository selector"
                        value={selectedGitHubRepoUrl}
                        onChange={(event) => setSelectedGitHubRepoUrl(event.target.value)}
                        disabled={githubLoading || githubRepos.length === 0}
                      >
                        {githubRepos.map((repository) => (
                          <option key={repository.id} value={repository.htmlUrl}>
                            {repository.fullName} {repository.private ? "(Private)" : "(Public)"}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true" className="atlas-select__chevron" />
                    </div>
                    <button
                      type="button"
                      disabled={isAnalyzing || !selectedGitHubRepoUrl}
                      onClick={() => void handleGitHubSelectorAnalyze()}
                    >
                      Analyze Selected
                    </button>
                  </div>
                  {githubLoading ? <span className="github-repo-panel__empty">Loading repositories</span> : null}
                  {!githubLoading && githubRepos.length === 0 ? (
                    <span className="github-repo-panel__empty">No repositories found</span>
                  ) : null}
                  {githubError ? <p className="github-repo-panel__error">{githubError}</p> : null}
                </section>
              ) : (
                <div className="github-connect-strip">
                  <span>
                    {githubStatus.configured
                      ? "GitHub account available. Open the graph view to connect."
                      : "Set GitHub OAuth env vars to enable connected repositories."}
                  </span>
                </div>
              )}
            </div>

            <div className="analyze-form is-secondary">
              {isAnalyzing ? (
                <div className="analyze-progress-chip" aria-live="polite">
                  <span>Analyzing</span>
                  <strong>{formatDuration(analyzeElapsedMs)}</strong>
                </div>
              ) : null}
              {!isAnalyzing && lastAnalyzeTiming ? (
                <div className="analyze-progress-chip is-timing" aria-live="polite">
                  <span>Clone {formatDuration(lastAnalyzeTiming.cloneMs)}</span>
                  <span>Graph {formatDuration(lastAnalyzeTiming.extractGraphMs)}</span>
                  <span>History {formatDuration(lastAnalyzeTiming.extractHistoryMs)}</span>
                  <strong>Total {formatDuration(lastAnalyzeTiming.totalMs)}</strong>
                </div>
              ) : null}
              <form className="analyze-form analyze-form--inline" onSubmit={handleSubmit}>
                <input
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo"
                  aria-label="GitHub repository URL"
                />
                <button type="submit" disabled={isAnalyzing || repoUrl.trim().length === 0}>
                  {isAnalyzing ? "Analyzing" : "Analyze URL"}
                </button>
              </form>
            </div>
          </div>
          {isAnalyzing ? (
            <div className="repo-fetch-bar" role="progressbar" aria-label="Fetching repository">
              <span />
            </div>
          ) : null}
        </header>
      ) : null}

      {showWorkflowChrome ? (
        <section className="toolbar">
          <div className="status">
            {!error && functionStatusSummary ? (
              <button
                type="button"
                className={functionSummaryExpanded ? "status__functions-button is-expanded" : "status__functions-button"}
                aria-expanded={functionSummaryExpanded}
                title={functionSummaryExpanded ? "Collapse function counts" : "Show function counts"}
                onClick={() => setFunctionSummaryExpanded((expanded) => !expanded)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 4 4 12l5 8" />
                  <path d="m15 4 5 8-5 8" />
                  <path d="M13 7 11 17" />
                </svg>
                <span>Functions</span>
                {functionSummaryExpanded ? (
                  <>
                    <strong>{functionStatusSummary.raw}</strong>
                    <span>raw /</span>
                    <strong>{functionStatusSummary.runtime}</strong>
                    <span>runtime /</span>
                    <strong>{functionStatusSummary.ghost}</strong>
                    <span>ghost</span>
                    <span
                      className="status__functions-open"
                      role="button"
                      tabIndex={0}
                      title="Open function inventory"
                      aria-label="Open function inventory"
                      onClick={(event) => {
                        event.stopPropagation();
                        openFunctionInventory();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          openFunctionInventory();
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 17 17 7" />
                        <path d="M9 7h8v8" />
                      </svg>
                    </span>
                  </>
                ) : (
                  <strong>{functionStatusSummary.raw}</strong>
                )}
              </button>
            ) : null}
          </div>
          <div className="toolbar__controls">
            <div className={saveLoadExpanded ? "saved-map-controls is-expanded" : "saved-map-controls"} aria-label="Saved maps">
              <button
                type="button"
                className="saved-map-controls__toggle"
                aria-expanded={saveLoadExpanded}
                title={saveLoadExpanded ? "Collapse save and load controls" : "Open save and load controls"}
                onClick={() => setSaveLoadExpanded((expanded) => !expanded)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 4h11l3 3v13H5z" />
                  <path d="M8 4v6h8V4" />
                  <path d="M8 16h8" />
                </svg>
              </button>
              {saveLoadExpanded ? (
                <>
                  <input
                    className="saved-map-controls__name"
                    value={saveMapName}
                    onChange={(event) => setSaveMapName(event.target.value)}
                    placeholder="Save name"
                    aria-label="Saved map name"
                    disabled={!githubStatus.connected || !graph || isSavingGraph || isLoadingSharedGraph}
                    required
                  />
                  <button
                    type="button"
                    className="saved-map-controls__save"
                    disabled={
                      !githubStatus.connected ||
                      !graph ||
                      !currentGraphRepoUrl ||
                      !currentGraphViewState ||
                      saveMapName.trim().length === 0 ||
                      isLoadingSharedGraph ||
                      isSavingGraph
                    }
                    title={githubStatus.connected ? "Save the current graph map" : "Connect GitHub to save maps"}
                    onClick={() => void handleSaveCurrentGraph()}
                  >
                    {isSavingGraph ? "Saving" : "Save Map"}
                  </button>
                  {githubStatus.connected ? (
                    <>
                      <div className="saved-map-controls__select">
                        <select
                          aria-label="Saved map selector"
                          value={selectedSavedGraphId}
                          disabled={savedGraphsLoading || savedGraphs.length === 0 || isLoadingSavedGraph}
                          onChange={(event) => setSelectedSavedGraphId(event.target.value)}
                        >
                          {savedGraphs.length === 0 ? (
                            <option value="">{savedGraphsLoading ? "Loading saved maps" : "No saved maps"}</option>
                          ) : null}
                          {savedGraphs.map((savedGraph) => (
                            <option key={savedGraph.id} value={savedGraph.id}>
                              {savedGraph.saveName} - {savedGraph.repoLabel} - {savedGraph.nodeCount} nodes - {compactUpdatedAt(savedGraph.updatedAt)}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden="true" />
                      </div>
                      <button
                        type="button"
                        className="saved-map-controls__open"
                        disabled={!selectedSavedGraphId || savedGraphsLoading || isLoadingSavedGraph}
                        onClick={() => void handleOpenSavedGraph()}
                      >
                        {isLoadingSavedGraph ? "Opening" : "Open"}
                      </button>
                      <button
                        type="button"
                        className="saved-map-controls__share"
                        disabled={!selectedSavedGraphId || savedGraphsLoading || isLoadingSavedGraph || isSharingGraph}
                        title="Copy a read-only share link for the selected saved map"
                        onClick={() => void handleCopyShareLink()}
                      >
                        {isSharingGraph ? "Copying" : "Link"}
                      </button>
                    </>
                  ) : null}
                  {savedGraphsError ? (
                    <span className="saved-map-controls__error" title={savedGraphsError}>Save error</span>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="cluster-switch" aria-label="Clustering mode">
              {clusteringOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={option.id === clusteringMode ? "cluster-switch__button is-active" : "cluster-switch__button"}
                  disabled={!option.enabled}
                  title={option.enabled ? `${option.label} clustering` : `${option.label} clustering is planned`}
                  onClick={() => setClusteringMode(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              className="search-input"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search files or folders"
              aria-label="Search files or folders"
            />
          </div>
        </section>
      ) : null}

      <GraphView
        graph={graph}
        searchTerm={searchTerm}
        clusteringMode={clusteringMode}
        repoUrl={repoUrl}
        onRepoUrlChange={setRepoUrl}
        onAnalyzeRepoUrl={handleAnalyzeRepoUrl}
        onAnalyzeExampleRepo={handleAnalyzeExampleRepo}
        initialViewState={restoreGraphViewState}
        viewStateKey={restoreGraphViewStateKey}
        onViewStateChange={handleGraphViewStateChange}
        githubConnected={githubStatus.connected}
        githubUserLogin={githubStatus.user?.login}
        onConnectGitHub={handleConnectGitHub}
      />
      {functionModalOpen && functionStatusSummary ? (
        <div className="function-modal" role="dialog" aria-modal="true" aria-label="Function inventory">
          <div className="function-modal__backdrop" onClick={closeFunctionInventory} />
          <div
            className={`function-modal__panel ${isFunctionPanelResizing ? "is-resizing" : ""}`.trim()}
            style={{ "--function-panel-width": `${functionPanelWidth}px` } as AppStyle}
          >
            <header className="function-modal__header">
              <div>
                <h2>Function Inventory</h2>
                <div className="function-modal__totals">
                  <span>{functionStatusSummary.raw} Raw</span>
                  <span>{functionStatusSummary.runtime} Runtime</span>
                  <span>{functionStatusSummary.ghost} Ghost</span>
                </div>
              </div>
              <button type="button" onClick={closeFunctionInventory} aria-label="Close function inventory">
                Close
              </button>
            </header>
            <div className="function-modal__sort" aria-label="Function sort method">
              {FUNCTION_SORT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={option.id === functionSortMode ? "is-active" : ""}
                  onClick={() => setFunctionSortMode(option.id)}
                >
                  {option.label}
                </button>
              ))}
              <span
                className="function-modal__sort-explanation"
                title={FUNCTION_SORT_EXPLANATIONS[functionSortMode]}
              >
                {FUNCTION_SORT_EXPLANATIONS[functionSortMode]}
              </span>
            </div>
            <div className="function-modal__surface">
              <aside className="function-modal__list" aria-label="Functions by operational group">
                <div className="function-modal__table function-modal__function-groups" aria-label="Functions by operational group">
                  {functionInventoryGroups.map((group) => {
                    const isCollapsed = collapsedFunctionInventoryGroupSet.has(group.id);

                    return (
                      <section
                        className={`function-modal__function-group ${isCollapsed ? "is-collapsed" : "is-expanded"}`}
                        key={group.id}
                      >
                        <button
                          type="button"
                          className="function-modal__function-group-toggle"
                          aria-expanded={!isCollapsed}
                          onClick={() => toggleFunctionInventoryGroup(group.id)}
                        >
                          <span>{group.label}</span>
                          <small>{group.items.length}</small>
                          <i aria-hidden="true" />
                        </button>
                        {!isCollapsed ? (
                          <div className="function-modal__function-rows">
                            {group.items.map((item) => (
                              <button
                                className={`function-modal__function-row ${functionPressureClass(item)} ${item.id === selectedFunctionId ? "is-active" : ""}`.trim()}
                                key={`${group.id}:${item.id}`}
                                type="button"
                                onClick={() => setSelectedFunctionId(item.id)}
                              >
                                <span className="function-modal__function-main">
                                  <span className="function-modal__function-name-row">
                                    <strong>{item.label}()</strong>
                                    <span className="function-modal__function-impact">impact {item.importance}</span>
                                  </span>
                                  <small>{item.filePath}:{item.startLine}</small>
                                </span>
                                <span className="function-modal__function-tags">
                                  {item.tags.map((tag) => (
                                    <span className={tagClassName(tag)} key={tag}>{tag}</span>
                                  ))}
                                  {item.score >= 8 || item.cyclomatic >= 10 || item.cognitive >= 12 ? (
                                    <span className="is-complex">complexity {Math.round(item.score)}</span>
                                  ) : null}
                                  <span>{item.lineCount} lines</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                  {functionInventoryGroups.length === 0 ? (
                    <p className="function-modal__empty">No extracted functions.</p>
                  ) : null}
                </div>
              </aside>
              <div
                className="function-modal__splitter"
                role="separator"
                aria-label="Resize function inventory"
                aria-orientation="vertical"
                aria-valuemin={FUNCTION_PANEL_MIN_WIDTH}
                aria-valuemax={FUNCTION_PANEL_MAX_WIDTH}
                aria-valuenow={functionPanelWidth}
                tabIndex={0}
                onPointerDown={beginFunctionPanelResize}
                onKeyDown={resizeFunctionPanelWithKeyboard}
              >
                <span aria-hidden="true" />
              </div>
              <section className="function-modal__source" aria-label="Selected function implementation">
                {selectedFunctionFile && selectedFunction ? (
                  <>
                    <div className="function-modal__purpose-card">
                      <div className="function-modal__purpose-head">
                        <span>Function Purpose</span>
                        <strong>{selectedFunction.label}()</strong>
                      </div>
                      <p>{selectedFunction.purpose}</p>
                      <div className="function-modal__observation">
                        <span>Observation</span>
                        <p>{selectedFunction.observation}</p>
                      </div>
                    </div>
                    <div className="function-modal__source-code">
                      <Suspense fallback={<div className="function-modal__source-loading">Loading function</div>}>
                        <SourceCodeModal
                          file={selectedFunctionFile}
                          sourceFiles={graph?.nodes.filter((node) => node.type === "file")}
                          onClose={() => setSelectedFunctionId(null)}
                          embedded
                          functionOnly
                          initialFunctionId={selectedFunction.sourceFunctionId}
                          inventoryRuntimeFunctionIds={selectedFunction.runtimeFunctionIds}
                        />
                      </Suspense>
                    </div>
                  </>
                ) : (
                  <div className="function-modal__source-empty">
                    <strong>Select a function</strong>
                    <span>Pick one function to see its purpose and code.</span>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
      {publicSearchOpen ? (
        <div className="public-search-modal" role="dialog" aria-modal="true" aria-label="Search public GitHub repositories">
          <div className="public-search-modal__backdrop" onClick={() => setPublicSearchOpen(false)} />
          <div className="public-search-modal__panel">
            <header className="public-search-modal__header">
              <h2>Search Public GitHub Repositories</h2>
              <button type="button" onClick={() => setPublicSearchOpen(false)} aria-label="Close public repository search">
                Close
              </button>
            </header>
            <input
              value={publicSearchQuery}
              onChange={(event) => setPublicSearchQuery(event.target.value)}
              placeholder="e.g. react flow graph"
              aria-label="Search public GitHub repositories"
              autoFocus
            />
            <div className="public-search-modal__results">
              {publicSearchQuery.trim().length < 2 ? <p>Type at least 2 characters.</p> : null}
              {publicSearchLoading ? <p>Searching repositories...</p> : null}
              {!publicSearchLoading && publicSearchQuery.trim().length >= 2 && publicSearchResults.length === 0 ? (
                <p>No repositories found.</p>
              ) : null}
              {publicSearchResults.map((repository) => (
                <button
                  key={repository.id}
                  type="button"
                  onClick={() => void handleAnalyzePublicRepository(repository)}
                  disabled={isAnalyzing}
                >
                  <strong>{repository.fullName}</strong>
                  <span>{repository.description ?? "No description."}</span>
                  <div className="public-search-modal__repo-meta">
                    <span className="public-search-modal__estimate">
                      Est. Analyze {formatDuration(estimateAnalyzeDuration(repository))}
                    </span>
                    <span>{repository.language ?? "Unknown language"}</span>
                    <span>★ {repository.stargazersCount ?? 0}</span>
                    <span>Updated {compactUpdatedAt(repository.updatedAt)}</span>
                  </div>
                  {(repository.topics?.length ?? 0) > 0 ? (
                    <div className="public-search-modal__repo-topics">
                      {repository.topics?.slice(0, 4).map((topic) => (
                        <span key={topic}>{topic}</span>
                      ))}
                    </div>
                  ) : null}
                </button>
              ))}
              {publicSearchError ? <p className="public-search-modal__error">{publicSearchError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

