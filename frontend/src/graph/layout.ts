import type { Edge, Node } from "@xyflow/react";
import type { AtlasEdge, AtlasGraph, AtlasNode } from "../api";
import { resolveOverlaps } from "./overlap";

export interface ContextBreadcrumbItem {
  id: string | null;
  label: string;
  path: string | null;
}

export interface ContextLayoutResult {
  nodes: AtlasFlowNode[];
  edges: AtlasFlowEdge[];
  breadcrumbPath: ContextBreadcrumbItem[];
  contextLabel: string;
  level: number;
  totalChildren: number;
  visibleChildren: number;
  hiddenChildren: number;
  currentPage: number;
  totalPages: number;
}

export type AtlasFlowNode = Node<AtlasNode, "domain" | "folder" | "file">;
export type AtlasFlowEdge = Edge<Record<string, unknown>, "smoothstep">;

const MAX_VISIBLE_CHILDREN = 30;
const DOMAIN_NODE_WIDTH = 286;
const DOMAIN_NODE_HEIGHT = 138;
const FOLDER_NODE_WIDTH = 246;
const FOLDER_NODE_HEIGHT = 108;
const FILE_NODE_WIDTH = 226;
const FILE_NODE_HEIGHT = 96;
const GRID_GAP_X = 46;
const GRID_GAP_Y = 34;
const GROUP_GAP_Y = 70;

const IMPORT_PARSE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const EXTENSION_LABELS = new Map<string, string>([
  [".md", "Docs"],
  [".mdx", "Docs"],
  [".json", "Config"],
  [".yml", "Config"],
  [".yaml", "Config"],
  [".toml", "Config"],
  [".css", "Styles"],
  [".scss", "Styles"],
  [".sass", "Styles"],
  [".less", "Styles"],
  [".html", "Markup"],
  [".svg", "Assets"],
  [".xml", "Data"],
  [".txt", "Text"],
  [".ps1", "Scripts"],
  [".sh", "Scripts"]
]);

function depthOf(path: string): number {
  return path.split("/").length - 1;
}

export function structuralDepthOf(path: string): number {
  return depthOf(path);
}

function childrenForContext(graph: AtlasGraph, contextId: string | null): AtlasNode[] {
  return graph.nodes
    .filter((node) => (node.parent ?? null) === contextId)
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }

      return a.path.localeCompare(b.path);
    });
}

function scoreNode(node: AtlasNode): number {
  if (node.type === "folder") {
    return 1000 + Number(node.metadata?.childCount ?? 0);
  }

  return Number(node.metadata?.importCount ?? 0);
}

function extensionOf(node: AtlasNode): string {
  return String(node.metadata?.extension ?? "").toLowerCase();
}

function fileClusterType(node: AtlasNode): string {
  const extension = extensionOf(node);

  if (IMPORT_PARSE_EXTENSIONS.has(extension)) {
    return "Source";
  }

  return EXTENSION_LABELS.get(extension) ?? (extension ? extension.slice(1).toUpperCase() : "Other");
}

function childSortGroup(node: AtlasNode): string {
  if (node.type === "folder") {
    return "0:Folders";
  }

  if (IMPORT_PARSE_EXTENSIONS.has(extensionOf(node))) {
    return "1:Source";
  }

  return `2:${fileClusterType(node)}`;
}

function prioritizeChildren(children: AtlasNode[]): AtlasNode[] {
  return children.slice().sort((a, b) => {
    const groupComparison = childSortGroup(a).localeCompare(childSortGroup(b));
    if (groupComparison !== 0) {
      return groupComparison;
    }

    if (a.type === "folder" || b.type === "folder" || childSortGroup(a) === "1:Source") {
      return scoreNode(b) - scoreNode(a) || a.path.localeCompare(b.path);
    }

    return a.path.localeCompare(b.path);
  });
}

function nodeDimensions(node: AtlasNode, level: number): { width: number; height: number; scale: number } {
  if (level === 0 && node.type === "folder") {
    return { width: DOMAIN_NODE_WIDTH, height: DOMAIN_NODE_HEIGHT, scale: 1 };
  }

  if (node.type === "folder") {
    return { width: FOLDER_NODE_WIDTH, height: FOLDER_NODE_HEIGHT, scale: 1 };
  }

  return { width: FILE_NODE_WIDTH, height: FILE_NODE_HEIGHT, scale: 1 };
}

function flowNodeType(node: AtlasNode, level: number): "domain" | "folder" | "file" {
  if (level === 0 && node.type === "folder") {
    return "domain";
  }

  return node.type;
}

function withLayoutData(node: AtlasNode, level: number): AtlasNode {
  const dimensions = nodeDimensions(node, level);

  return {
    ...node,
    layoutDepth: level,
    layoutScale: dimensions.scale,
    layoutWidth: dimensions.width,
    layoutHeight: dimensions.height,
    viewVariant: flowNodeType(node, level) === "domain" ? "domain-card" : "rect",
    fileClusterType: node.type === "file" ? fileClusterType(node) : undefined,
    isImportParsed: node.type === "file" ? IMPORT_PARSE_EXTENSIONS.has(extensionOf(node)) : undefined
  };
}

function buildBreadcrumbPath(graph: AtlasGraph, contextId: string | null): ContextBreadcrumbItem[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const ancestors: AtlasNode[] = [];
  let cursor = contextId ? byId.get(contextId) : undefined;

  while (cursor) {
    ancestors.unshift(cursor);
    cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
  }

  return [
    { id: null, label: "Root", path: null },
    ...ancestors.map((node) => ({
      id: node.id,
      label: node.label,
      path: node.path
    }))
  ];
}

function columnsForCount(count: number, level: number): number {
  if (count <= 1) {
    return 1;
  }

  const naturalColumns = Math.ceil(Math.sqrt(count));
  const maxColumns = level === 0 ? 4 : 5;

  return Math.min(maxColumns, naturalColumns);
}

function buildVisibleNodes(visibleChildren: AtlasNode[], level: number): AtlasFlowNode[] {
  const groupedChildren = new Map<string, AtlasNode[]>();

  for (const child of visibleChildren) {
    const group = childSortGroup(child);
    const existing = groupedChildren.get(group) ?? [];
    existing.push(child);
    groupedChildren.set(group, existing);
  }

  const nodes: AtlasFlowNode[] = [];
  let yOffset = 0;

  for (const [, groupChildren] of [...groupedChildren.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const columns = columnsForCount(groupChildren.length, level);
    let maxBottom = yOffset;

    groupChildren.forEach((child, index) => {
      const dimensions = nodeDimensions(child, level);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const y = yOffset + row * (dimensions.height + GRID_GAP_Y);

      maxBottom = Math.max(maxBottom, y + dimensions.height);
      nodes.push({
      id: child.id,
      type: flowNodeType(child, level),
      position: {
        x: column * (dimensions.width + GRID_GAP_X),
        y
      },
      data: withLayoutData(child, level)
      });
    });

    yOffset = maxBottom + GROUP_GAP_Y;
  }

  return nodes;
}

function ownsPath(owner: AtlasNode, path: string): boolean {
  if (owner.type === "file") {
    return owner.path === path;
  }

  return path === owner.path || path.startsWith(`${owner.path}/`);
}

function ownerForPath(path: string, visibleChildren: AtlasNode[]): AtlasNode | undefined {
  return visibleChildren.find((child) => ownsPath(child, path));
}

function edgeKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function makeImportEdge(source: string, target: string, count: number): AtlasFlowEdge {
  return {
    id: `context:${source}->${target}`,
    source,
    target,
    type: "smoothstep",
    animated: false,
    data: {
      kind: "context-import",
      importCount: count
    },
    style: {
      stroke: "#60a5fa",
      strokeWidth: Math.min(2.4, 1.1 + count * 0.18),
      opacity: 0.64
    }
  };
}

function buildContextEdges(graphEdges: AtlasEdge[], visibleChildren: AtlasNode[]): AtlasFlowEdge[] {
  const localEdgeCounts = new Map<string, { source: string; target: string; count: number }>();

  for (const edge of graphEdges) {
    const sourceOwner = ownerForPath(edge.source, visibleChildren);
    const targetOwner = ownerForPath(edge.target, visibleChildren);

    if (!sourceOwner || !targetOwner || sourceOwner.id === targetOwner.id) {
      continue;
    }

    const key = edgeKey(sourceOwner.id, targetOwner.id);
    const existing = localEdgeCounts.get(key);
    localEdgeCounts.set(key, {
      source: sourceOwner.id,
      target: targetOwner.id,
      count: (existing?.count ?? 0) + 1
    });
  }

  return [...localEdgeCounts.values()]
    .sort((a, b) => edgeKey(a.source, a.target).localeCompare(edgeKey(b.source, b.target)))
    .map((edge) => makeImportEdge(edge.source, edge.target, edge.count));
}

export function layoutStructuralContext(
  graph: AtlasGraph,
  currentContextId: string | null,
  pageIndex = 0
): ContextLayoutResult {
  const contextNode = currentContextId ? graph.nodes.find((node) => node.id === currentContextId) : undefined;
  const resolvedContextId = currentContextId && contextNode?.type === "folder" ? currentContextId : null;
  const allChildren = childrenForContext(graph, resolvedContextId);
  const level = resolvedContextId ? depthOf(resolvedContextId) + 1 : 0;
  const prioritizedChildren = prioritizeChildren(allChildren);
  const totalPages = Math.max(1, Math.ceil(prioritizedChildren.length / MAX_VISIBLE_CHILDREN));
  const currentPage = Math.min(Math.max(0, pageIndex), totalPages - 1);
  const visibleChildren = prioritizedChildren.slice(
    currentPage * MAX_VISIBLE_CHILDREN,
    (currentPage + 1) * MAX_VISIBLE_CHILDREN
  );
  const hiddenChildren = prioritizedChildren.filter((node) => !visibleChildren.some((visible) => visible.id === node.id));
  const nodes = buildVisibleNodes(visibleChildren, level);
  const edges = buildContextEdges(graph.edges, visibleChildren);
  const collisionResult = resolveOverlaps(nodes);
  const resolvedNodes = collisionResult.nodes.map((node) => ({
    ...node,
    data: {
      ...(node.data as AtlasNode),
      isVeryClose: collisionResult.veryCloseNodeIds.has(node.id)
    }
  }));
  const breadcrumbPath = buildBreadcrumbPath(graph, resolvedContextId);

  return {
    nodes: resolvedNodes,
    edges,
    breadcrumbPath,
    contextLabel: breadcrumbPath[breadcrumbPath.length - 1]?.label ?? "Root",
    level,
    totalChildren: allChildren.length,
    visibleChildren: visibleChildren.length,
    hiddenChildren: hiddenChildren.length,
    currentPage,
    totalPages
  };
}
