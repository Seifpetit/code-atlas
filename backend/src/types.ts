export type GraphNodeType = "folder" | "file";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  path: string;
  parent?: string;
  metadata?: {
    extension?: string;
    importCount?: number;
    childCount?: number;
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
  imports: Array<{
    source: string;
    target: string;
  }>;
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
