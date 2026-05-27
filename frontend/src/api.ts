export interface AtlasNode extends Record<string, unknown> {
  id: string;
  type: "folder" | "file";
  label: string;
  path: string;
  parent?: string;
  sourceText?: string;
  metadata?: {
    extension?: string;
    importCount?: number;
    childCount?: number;
    linesOfCode?: number;
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
}

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const API_BASE_URL = configuredApiBaseUrl ?? (import.meta.env.DEV ? "http://localhost:4000" : "");

export async function analyzeRepo(repoUrl: string): Promise<AtlasGraph> {
  const response = await fetch(`${API_BASE_URL}/analyze`, {
    method: "POST",
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
