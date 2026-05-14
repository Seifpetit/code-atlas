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
}

export interface ExtractedStructure {
  folders: Set<string>;
  files: Set<string>;
  imports: Array<{
    source: string;
    target: string;
  }>;
}
