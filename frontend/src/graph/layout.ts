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
  lineageEdges: AtlasFlowEdge[];
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
export type AtlasFlowEdge = Edge<Record<string, unknown>, "structural">;

const MAX_VISIBLE_CHILDREN = 30;
const DOMAIN_NODE_WIDTH = 286;
const DOMAIN_NODE_HEIGHT = 138;
const FOLDER_NODE_WIDTH = 246;
const FOLDER_NODE_HEIGHT = 108;
const FILE_NODE_WIDTH = 130;
const FILE_NODE_HEIGHT = 180;
const LINEAGE_NODE_WIDTH = 178;
const LINEAGE_NODE_HEIGHT = 72;
const LINEAGE_GAP_X = 34;
const LINEAGE_Y = 0;
const CHILDREN_Y_OFFSET = 150;
const GRID_GAP_Y = 34;
const GROUP_GAP_Y = 70;
const GROUP_GAP_X = 90;

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

  const compressionPenalty = isLowSignalCompressed(node) ? -100000 : 0;
  return (
    compressionPenalty +
    Number(node.metadata?.importCount ?? 0) * 1000 +
    Number(node.metadata?.functionCount ?? 0) * 10 +
    Math.min(Number(node.metadata?.linesOfCode ?? 0), 500)
  );
}

function extensionOf(node: AtlasNode): string {
  return String(node.metadata?.extension ?? "").toLowerCase();
}

function isLowSignalCompressed(node: AtlasNode): boolean {
  return node.type === "file" && node.metadata?.compressionLevel === "low-signal";
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

    const compressionComparison = Number(isLowSignalCompressed(a)) - Number(isLowSignalCompressed(b));
    if (compressionComparison !== 0) {
      return compressionComparison;
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

function significanceForNode(node: AtlasNode, graph: AtlasGraph): number {
  const fileHistory = graph.fileHistory ?? {};

  if (node.type === "file") {
    return fileHistory[node.path]?.commitCount ?? 0;
  }

  return Object.values(fileHistory).reduce((total, history) => {
    return history.path === node.path || history.path.startsWith(`${node.path}/`)
      ? total + history.commitCount
      : total;
  }, 0);
}

function significanceLevel(score: number): string | undefined {
  if (score >= 18) {
    return "high";
  }

  if (score >= 6) {
    return "medium";
  }

  if (score > 0) {
    return "low";
  }

  return undefined;
}

function withLayoutData(node: AtlasNode, level: number, graph: AtlasGraph): AtlasNode {
  const dimensions = nodeDimensions(node, level);
  const significanceScore = significanceForNode(node, graph);

  return {
    ...node,
    layoutDepth: level,
    layoutScale: dimensions.scale,
    layoutWidth: dimensions.width,
    layoutHeight: dimensions.height,
    viewVariant: flowNodeType(node, level) === "domain" ? "domain-card" : "rect",
    fileClusterType: node.type === "file" ? fileClusterType(node) : undefined,
    isImportParsed: node.type === "file" ? IMPORT_PARSE_EXTENSIONS.has(extensionOf(node)) : undefined,
    significanceScore,
    significanceLevel: significanceLevel(significanceScore)
  };
}

function ancestorNodesForContext(graph: AtlasGraph, contextId: string | null): AtlasNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const ancestors: AtlasNode[] = [];
  let cursor = contextId ? byId.get(contextId) : undefined;

  while (cursor) {
    ancestors.unshift(cursor);
    cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
  }

  return ancestors;
}

function buildBreadcrumbPath(graph: AtlasGraph, contextId: string | null): ContextBreadcrumbItem[] {
  const ancestors = ancestorNodesForContext(graph, contextId);

  return [
    { id: null, label: "Root", path: null },
    ...ancestors.map((node) => ({
      id: node.id,
      label: node.label,
      path: node.path
    }))
  ];
}

function lineageNodeId(id: string): string {
  return `__lineage__:${id}`;
}

function makeLineageEdge(source: string, target: string, kind: "lineage-chain" | "lineage-child"): AtlasFlowEdge {
  return {
    id: `${kind}:${source}->${target}`,
    source,
    target,
    type: "structural",
    animated: false,
    zIndex: 0,
    data: {
      kind
    }
  };
}

function buildLineageNodes(ancestors: AtlasNode[], graph: AtlasGraph): AtlasFlowNode[] {
  const rootSignificanceScore = Object.values(graph.fileHistory ?? {}).reduce(
    (total, history) => total + history.commitCount,
    0
  );
  const rootNode: AtlasFlowNode = {
    id: lineageNodeId("root"),
    type: "folder",
    position: { x: 0, y: 0 },
    zIndex: 0,
    width: LINEAGE_NODE_WIDTH,
    height: LINEAGE_NODE_HEIGHT,
    initialWidth: LINEAGE_NODE_WIDTH,
    initialHeight: LINEAGE_NODE_HEIGHT,
    draggable: false,
    selectable: false,
    data: {
      id: "root",
      type: "folder",
      label: "Root",
      path: "Root",
      metadata: { childCount: graph.nodes.filter((node) => !node.parent).length },
      layoutWidth: LINEAGE_NODE_WIDTH,
      layoutHeight: LINEAGE_NODE_HEIGHT,
      layoutDepth: 0,
      layoutScale: 0.9,
      viewVariant: "lineage-anchor",
      lineageKind: "root",
      significanceScore: rootSignificanceScore,
      significanceLevel: significanceLevel(rootSignificanceScore)
    }
  };
  const lineageAncestors = ancestors.map((ancestor, index) => {
    return {
      id: lineageNodeId(ancestor.id),
      type: flowNodeType(ancestor, index) as "domain" | "folder" | "file",
      position: {
        x: (index + 1) * (LINEAGE_NODE_WIDTH + LINEAGE_GAP_X),
        y: LINEAGE_Y
      },
      zIndex: index + 1,
      width: LINEAGE_NODE_WIDTH,
      height: LINEAGE_NODE_HEIGHT,
      initialWidth: LINEAGE_NODE_WIDTH,
      initialHeight: LINEAGE_NODE_HEIGHT,
      draggable: false,
      selectable: false,
      data: {
        ...withLayoutData(ancestor, index + 1, graph),
        layoutWidth: LINEAGE_NODE_WIDTH,
        layoutHeight: LINEAGE_NODE_HEIGHT,
        layoutScale: 0.9,
        viewVariant: "lineage-anchor",
        lineageKind: "ancestor"
      }
    };
  });

  return ancestors.length > 0 ? [rootNode, ...lineageAncestors] : [];
}

function buildVisibleNodes(visibleChildren: AtlasNode[], level: number, graph: AtlasGraph): AtlasFlowNode[] {
  const groupedChildren = new Map<string, AtlasNode[]>();

  for (const child of visibleChildren) {
    const group = childSortGroup(child);
    const existing = groupedChildren.get(group) ?? [];
    existing.push(child);
    groupedChildren.set(group, existing);
  }

  const nodes: AtlasFlowNode[] = [];
  let xOffset = 0;

  for (const [, groupChildren] of [...groupedChildren.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let groupMaxWidth = 0;

    groupChildren.forEach((child, index) => {
      const dimensions = nodeDimensions(child, level);
      const x = xOffset;
      const y = index * (dimensions.height + GRID_GAP_Y);

      groupMaxWidth = Math.max(groupMaxWidth, dimensions.width);
      nodes.push({
        id: child.id,
        type: flowNodeType(child, level),
        position: {
          x,
          y: y + (level > 0 ? CHILDREN_Y_OFFSET : 0)
        },
        width: dimensions.width,
        height: dimensions.height,
        initialWidth: dimensions.width,
        initialHeight: dimensions.height,
        data: withLayoutData(child, level, graph)
      });
    });

    // Horizontal tree branches: each group becomes a "branch column block" in X.
    // Keep Y stable across groups so the view expands sideways instead of stacking downward.
    xOffset += Math.max(groupMaxWidth, 1) + GROUP_GAP_X;
  }

  return nodes;
}

function buildLineageEdges(ancestors: AtlasNode[], visibleChildren: AtlasNode[]): AtlasFlowEdge[] {
  if (ancestors.length === 0) {
    return [];
  }

  const lineageIds = [lineageNodeId("root"), ...ancestors.map((ancestor) => lineageNodeId(ancestor.id))];
  const chainEdges = lineageIds.slice(1).map((targetId, index) => {
    return makeLineageEdge(lineageIds[index], targetId, "lineage-chain");
  });
  const currentParentId = lineageIds[lineageIds.length - 1];
  const childEdges = visibleChildren.map((child) => makeLineageEdge(currentParentId, child.id, "lineage-child"));

  return [...chainEdges, ...childEdges];
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
  const ancestors = ancestorNodesForContext(graph, resolvedContextId);
  const lineageNodes = buildLineageNodes(ancestors, graph);
  const nodes = [...lineageNodes, ...buildVisibleNodes(visibleChildren, level, graph)];
  const edges = buildContextEdges(graph.edges, visibleChildren);
  const lineageEdges = buildLineageEdges(ancestors, visibleChildren);
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
    lineageEdges,
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
