export type GraphNodeType = "folder" | "file";
export type CompressionLevel = "low-signal";
export type CompressionReason =
  | "very-low-loc"
  | "tiny-wrapper"
  | "conventional-support-file"
  | "pass-through-export"
  | "package-gateway";
export type FunctionWaypointKind = "function" | "arrow" | "method" | "accessor" | "constructor" | "effect";
export type HealthTier = "healthy" | "warning" | "critical" | "unscored";
export type UnscoredHealthReason = "no-functions";

export interface HealthComponents {
  cyclomatic: number;
  cognitive: number;
  duplication: number;
  churn: number;
  ghostRatio: number;
}

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
  connectionKind?: "call" | "jsx-render";
  name: string;
  line: number;
  arguments: string[];
  definitionPath?: string;
  definitionName?: string;
  definitionWaypointId?: string;
  definitionStartLine?: number;
  definitionEndLine?: number;
}

export interface FunctionStateUpdate {
  state: string;
  setter: string;
  line: number;
  arguments: string[];
}

export type VariableDeclarationKind = "state" | "ref" | "const" | "let" | "var" | "assignment" | "iterator";

export interface VariableWaypoint {
  variableId: string;
  name: string;
  declarationLine: number;
  declarationKind: VariableDeclarationKind;
  usageLines: number[];
  mutationLines: number[];
  conditionLines: number[];
  renderingLines: number[];
  helperCallLines: number[];
  runtimeRelated: boolean;
}

export interface FunctionWaypoint {
  waypointId: string;
  name: string;
  kind: FunctionWaypointKind;
  startLine: number;
  endLine: number;
  exported: boolean;
  public?: boolean;
  exportNames?: string[];
  cyclomaticComplexity?: number;
  cognitiveComplexity: number;
  duplicateOf: string[] | null;
  duplicateGroup: string | null;
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
  healthScore?: number | null;
  healthTier?: HealthTier;
  healthComponents?: HealthComponents | null;
  unscoredReason?: UnscoredHealthReason;
  metadata?: {
    extension?: string;
    importCount?: number;
    childCount?: number;
    linesOfCode?: number;
    staticEntrypoint?: boolean;
    staticEntrypointKind?: "html-index";
    functionCount?: number;
    functionWaypoints?: FunctionWaypoint[];
    variableWaypoints?: VariableWaypoint[];
    moduleLinks?: FunctionCall[];
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
  retainedSourceBytes: number;
  imports: Array<{
    source: string;
    target: string;
  }>;
}

export interface ExtractedFileMetadata {
  linesOfCode: number;
  sourceText: string;
  staticEntrypoint?: boolean;
  staticEntrypointKind?: "html-index";
  functionCount?: number;
  functionWaypoints?: FunctionWaypoint[];
  variableWaypoints?: VariableWaypoint[];
  moduleLinks?: FunctionCall[];
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
