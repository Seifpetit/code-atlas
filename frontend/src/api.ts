export interface AtlasNode extends Record<string, unknown> {
  id: string;
  type: "folder" | "file";
  label: string;
  path: string;
  parent?: string;
  sourceText?: string;
  healthScore?: number | null;
  healthTier?: "healthy" | "warning" | "critical" | "unscored";
  healthComponents?: {
    cyclomatic: number;
    cognitive: number;
    duplication: number;
    churn: number;
    ghostRatio: number;
  } | null;
  unscoredReason?: "no-functions";
  metadata?: {
    extension?: string;
    importCount?: number;
    childCount?: number;
    linesOfCode?: number;
    staticEntrypoint?: boolean;
    staticEntrypointKind?: "html-index";
    functionCount?: number;
    functionWaypoints?: Array<{
      waypointId?: string;
      name: string;
      kind: "function" | "arrow" | "method" | "accessor" | "constructor" | "effect";
      startLine: number;
      endLine: number;
      exported: boolean;
      public?: boolean;
      exportNames?: string[];
      cyclomaticComplexity?: number;
      cognitiveComplexity?: number;
      duplicateOf?: string[] | null;
      duplicateGroup?: string | null;
      inputs: Array<{
        name: string;
        line: number;
        type?: string;
        sources?: Array<{
          filePath: string;
          functionName: string;
          line: number;
          expression: string;
        }>;
      }>;
      outputs: Array<{
        line: number;
        expression: string;
        type?: string;
        async: boolean;
      }>;
      calls: Array<{
        connectionKind?: "call" | "jsx-render";
        name: string;
        line: number;
        arguments: string[];
        definitionPath?: string;
        definitionName?: string;
        definitionWaypointId?: string;
        definitionStartLine?: number;
        definitionEndLine?: number;
      }>;
      stateUpdates: Array<{
        state: string;
        setter: string;
        line: number;
        arguments: string[];
      }>;
    }>;
    variableWaypoints?: Array<{
      variableId: string;
      name: string;
      declarationLine: number;
      declarationKind: "state" | "ref" | "const" | "let" | "var" | "assignment" | "iterator";
      usageLines: number[];
      mutationLines: number[];
      conditionLines: number[];
      renderingLines: number[];
      helperCallLines: number[];
      runtimeRelated: boolean;
    }>;
    moduleLinks?: Array<{
      connectionKind?: "call" | "jsx-render";
      name: string;
      line: number;
      arguments: string[];
      definitionPath?: string;
      definitionName?: string;
      definitionWaypointId?: string;
      definitionStartLine?: number;
      definitionEndLine?: number;
    }>;
    compressionLevel?: "low-signal";
    compressionReasons?: Array<
      "very-low-loc" | "tiny-wrapper" | "conventional-support-file" | "pass-through-export" | "package-gateway"
    >;
  };
}

export interface AtlasEdge extends Record<string, unknown> {
  id: string;
  source: string;
  target: string;
  type: "import";
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  changedFiles: string[];
}

export interface FileHistoryInfo {
  path: string;
  commitCount: number;
  churnRate?: number;
  lastModified: string;
  authors: string[];
  recentCommits: Array<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
  }>;
}

export interface AtlasGraph {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  commits?: CommitInfo[];
  fileHistory?: Record<string, FileHistoryInfo>;
  analyzeTiming?: {
    cloneMs: number;
    extractGraphMs: number;
    extractHistoryMs: number;
    totalMs: number;
  };
}

export interface SavedMapViewState {
  version: 1;
  currentContextId: string | null;
  pageIndex: number;
  focusedNodeId: string | null;
  selectedNodeId: string | null;
  filePanelView: "metadata" | "wires";
  metadataForecastNodeId: string | null;
  selectedCorridorIndex: number;
  clusteringMode: string;
  linkedCorridors: Array<{
    contextId: string | null;
    focusedNodeId: string;
    pageIndex: number;
  }>;
  corridorLinks: Array<{
    originCorridorIndex: number;
    originNodeId: string;
    targetCorridorIndex: number;
    targetNodeId: string;
    direction: "imports" | "imported-by";
    subdued?: boolean;
  }>;
  pinnedTraceGroups: Array<{
    key: string;
    edgeIds: string[];
    folderRelationCounts: Record<string, number>;
    anchor: {
      nodeId: string;
      corridorIndex: number;
    };
  }>;
  manualNodePositions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number } | null;
  visibleNodeIds: string[];
  visibleFlowNodeIds: string[];
  visibleEdgeIds: string[];
  activeTraceEdgeIds: string[];
}

export interface GitHubUser {
  id: number;
  login: string;
  name?: string | null;
  avatarUrl?: string;
  htmlUrl?: string;
}

export interface GitHubAuthStatus {
  configured: boolean;
  connected: boolean;
  user: GitHubUser | null;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  ownerLogin: string;
  defaultBranch: string;
  description?: string | null;
  pushedAt?: string | null;
  updatedAt?: string | null;
  stargazersCount?: number;
  language?: string | null;
  topics?: string[];
}

export interface SavedGraphSummary {
  id: string;
  saveName: string;
  shareToken: string | null;
  sharedAt: string | null;
  repoUrl: string;
  repoLabel: string;
  commitSha: string | null;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LoadedSavedGraph {
  savedGraph: SavedGraphSummary;
  graph: AtlasGraph;
  viewState: SavedMapViewState | null;
}

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const API_BASE_URL = configuredApiBaseUrl ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

export async function analyzeRepo(repoUrl: string): Promise<AtlasGraph> {
  const response = await fetch(`${API_BASE_URL}/analyze`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ repoUrl })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to analyze repository.");
  }

  return payload as AtlasGraph;
}

export function githubConnectUrl(): string {
  return `${API_BASE_URL}/auth/github`;
}

export async function getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  const response = await fetch(`${API_BASE_URL}/auth/github/status`, {
    credentials: "include"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to read GitHub connection status.");
  }

  return payload as GitHubAuthStatus;
}

export async function loadGitHubRepositories(query: string): Promise<GitHubRepository[]> {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set("query", query.trim());
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/github/repos${suffix}`, {
    credentials: "include"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to load GitHub repositories.");
  }

  return payload.repositories as GitHubRepository[];
}

export async function listSavedGraphs(): Promise<SavedGraphSummary[]> {
  const response = await fetch(`${API_BASE_URL}/graphs`, {
    credentials: "include"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to load saved maps.");
  }

  return payload.graphs as SavedGraphSummary[];
}

export async function loadSavedGraph(id: string): Promise<LoadedSavedGraph> {
  const response = await fetch(`${API_BASE_URL}/graphs/${encodeURIComponent(id)}`, {
    credentials: "include"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to open saved map.");
  }

  return payload as LoadedSavedGraph;
}

export async function saveGraph(
  repoUrl: string,
  name: string,
  graph: AtlasGraph,
  viewState: SavedMapViewState | null
): Promise<SavedGraphSummary> {
  const response = await fetch(`${API_BASE_URL}/graphs`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ repoUrl, name, graph, viewState })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to save map.");
  }

  return payload.savedGraph as SavedGraphSummary;
}

export async function shareSavedGraph(id: string): Promise<SavedGraphSummary> {
  const response = await fetch(`${API_BASE_URL}/graphs/${encodeURIComponent(id)}/share`, {
    method: "POST",
    credentials: "include"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to create share link.");
  }

  return payload.savedGraph as SavedGraphSummary;
}

export async function loadSharedGraph(shareToken: string): Promise<LoadedSavedGraph> {
  const response = await fetch(`${API_BASE_URL}/shared-graphs/${encodeURIComponent(shareToken)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to open shared map.");
  }

  return payload as LoadedSavedGraph;
}

export async function logoutGitHub(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/github/logout`, {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload?.error ?? "Failed to disconnect GitHub.");
  }
}

export async function searchPublicGitHubRepositories(query: string): Promise<GitHubRepository[]> {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set("query", query.trim());
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/github/public-repos${suffix}`, {
    credentials: "include"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to search public repositories.");
  }

  return payload.repositories as GitHubRepository[];
}
