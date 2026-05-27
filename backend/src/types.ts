export type GraphNodeType = "folder" | "file";
export type CompressionLevel = "low-signal";
export type CompressionReason =
  | "very-low-loc"
  | "tiny-wrapper"
  | "conventional-support-file"
  | "pass-through-export";
export type FunctionWaypointKind = "function" | "arrow" | "method" | "accessor" | "constructor" | "effect";

export interface FunctionInputSource {
  filePath: string;
  functionName: string;
  line: number;
  expression: string;
}

export interface FunctionInput {
  name: string;
  line: number;
  type?: string;
  sources?: FunctionInputSource[];
}

export interface FunctionOutput {
  line: number;
  expression: string;
  type?: string;
  async: boolean;
}

export interface FunctionCall {
  name: string;
  line: number;
  arguments: string[];
  definitionPath?: string;
  definitionName?: string;
}

export interface FunctionStateUpdate {
  state: string;
  setter: string;
  line: number;
  arguments: string[];
}

export interface FunctionWaypoint {
  name: string;
  kind: FunctionWaypointKind;
  startLine: number;
  endLine: number;
  exported: boolean;
  inputs: FunctionInput[];
  outputs: FunctionOutput[];
  calls: FunctionCall[];
  stateUpdates: FunctionStateUpdate[];
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
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
    functionWaypoints?: FunctionWaypoint[];
    compressionLevel?: CompressionLevel;
    compressionReasons?: CompressionReason[];
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "import";
}

export interface GraphJson {
  nodes: GraphNode[];
  edges: GraphEdge[];
  commits?: CommitInfo[];
  fileHistory?: Record<string, FileHistoryInfo>;
}

export interface ExtractedStructure {
  folders: Set<string>;
  files: Set<string>;
  fileMetadata: Map<string, ExtractedFileMetadata>;
  imports: Array<{
    source: string;
    target: string;
  }>;
}

export interface ExtractedFileMetadata {
  linesOfCode: number;
  sourceText: string;
  functionCount?: number;
  functionWaypoints?: FunctionWaypoint[];
  compressionReasons: CompressionReason[];
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

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
}

export interface DiffResult {
  baseCommit: string;
  targetCommit: string;
  changedFiles: DiffFile[];
}
