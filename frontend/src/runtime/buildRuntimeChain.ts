import type { AtlasEdge, AtlasGraph, AtlasNode } from "../api";
import type { RuntimeChain, RuntimeEdge, RuntimeNode } from "./runtimeTypes";

interface ChainCandidate {
  nextId: string;
  direction: "outgoing" | "incoming";
  edge: AtlasEdge;
  score: number;
}

const DEFAULT_MAX_DEPENDENCY_DEPTH = 5;
const DEFAULT_MAX_FILES = 8;

function depthOf(path: string): number {
  return path.split("/").length - 1;
}

function ownsPath(owner: AtlasNode, path: string): boolean {
  if (owner.type === "file") {
    return owner.path === path;
  }

  return path === owner.path || path.startsWith(`${owner.path}/`);
}

function topSegment(path: string): string {
  return path.split("/")[0] ?? path;
}

function subtreeKey(path: string): string {
  const parts = path.split("/");

  return parts.length > 1 ? parts.slice(0, 2).join("/") : parts[0] ?? path;
}

function dependencyScore(edge: AtlasEdge, source: AtlasNode, target: AtlasNode, direction: "outgoing" | "incoming"): number {
  const crossTopLevel = topSegment(source.path) !== topSegment(target.path) ? 800 : 0;
  const crossSubtree = subtreeKey(source.path) !== subtreeKey(target.path) ? 320 : 0;
  const directionBias = direction === "outgoing" ? 90 : 20;

  return crossTopLevel + crossSubtree + directionBias + Number(target.metadata?.importCount ?? 0);
}

function structuralAncestorIds(node: AtlasNode, byId: Map<string, AtlasNode>): string[] {
  const ancestors: string[] = [];
  let cursor = node.parent ? byId.get(node.parent) : undefined;

  while (cursor) {
    ancestors.unshift(cursor.id);
    cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
  }

  return ancestors;
}

function rankSeedFiles(graph: AtlasGraph, origin: AtlasNode, byId: Map<string, AtlasNode>): AtlasNode[] {
  const ownedFiles = graph.nodes.filter((node) => node.type === "file" && ownsPath(origin, node.path));
  const scores = new Map<string, number>();

  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);

    if (!source || !target) {
      continue;
    }

    if (ownedFiles.some((file) => file.id === source.id)) {
      const crossTopLevel = topSegment(source.path) !== topSegment(target.path) ? 800 : 0;
      scores.set(source.id, (scores.get(source.id) ?? 0) + crossTopLevel + 120 + Number(source.metadata?.importCount ?? 0));
    }

    if (ownedFiles.some((file) => file.id === target.id)) {
      const crossTopLevel = topSegment(source.path) !== topSegment(target.path) ? 500 : 0;
      scores.set(target.id, (scores.get(target.id) ?? 0) + crossTopLevel + 60 + Number(target.metadata?.importCount ?? 0));
    }
  }

  return ownedFiles
    .sort((a, b) => {
      const scoreDifference = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return Number(b.metadata?.importCount ?? 0) - Number(a.metadata?.importCount ?? 0) || a.path.localeCompare(b.path);
    });
}

function candidatesFor(
  node: AtlasNode,
  graph: AtlasGraph,
  byId: Map<string, AtlasNode>,
  visited: Set<string>
): ChainCandidate[] {
  return graph.edges
    .flatMap((edge): ChainCandidate[] => {
      if (edge.source === node.id) {
        const target = byId.get(edge.target);

        if (!target || target.type !== "file" || visited.has(target.id)) {
          return [];
        }

        return [{
          nextId: target.id,
          direction: "outgoing",
          edge,
          score: dependencyScore(edge, node, target, "outgoing")
        }];
      }

      if (edge.target === node.id) {
        const source = byId.get(edge.source);

        if (!source || source.type !== "file" || visited.has(source.id)) {
          return [];
        }

        return [{
          nextId: source.id,
          direction: "incoming",
          edge,
          score: dependencyScore(edge, node, source, "incoming")
        }];
      }

      return [];
    })
    .sort((a, b) => b.score - a.score || a.nextId.localeCompare(b.nextId));
}

function buildDependencyPath(
  graph: AtlasGraph,
  seed: AtlasNode,
  byId: Map<string, AtlasNode>,
  maxDepth: number,
  maxFiles: number
): AtlasNode[] {
  const path = [seed];
  const visited = new Set([seed.id]);
  let cursor = seed;

  for (let depth = 0; depth < maxDepth && path.length < maxFiles; depth += 1) {
    const next = candidatesFor(cursor, graph, byId, visited)[0];

    if (!next) {
      break;
    }

    const nextNode = byId.get(next.nextId);

    if (!nextNode) {
      break;
    }

    path.push(nextNode);
    visited.add(nextNode.id);
    cursor = nextNode;
  }

  return path;
}

function appendFileNode(orderedIds: string[], node: AtlasNode, maxFiles: number): void {
  if (node.type === "file" && !orderedIds.includes(node.id) && orderedIds.length < maxFiles) {
    orderedIds.push(node.id);
  }
}

function edgeKey(source: string, target: string, relationType: RuntimeEdge["relationType"]): string {
  return `${relationType}:${source}->${target}`;
}

export function buildRuntimeChain(
  graph: AtlasGraph,
  originNodeId: string,
  options: {
    maxDependencyDepth?: number;
    maxFiles?: number;
  } = {}
): RuntimeChain | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const origin = byId.get(originNodeId);

  if (!origin) {
    return null;
  }

  const maxDepth = options.maxDependencyDepth ?? DEFAULT_MAX_DEPENDENCY_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const seed = origin.type === "file" ? origin : rankSeedFiles(graph, origin, byId)[0];
  const dependencyPath = seed ? buildDependencyPath(graph, seed, byId, maxDepth, maxFiles) : [];
  const orderedIds: string[] = [];

  for (const pathNode of dependencyPath) {
    appendFileNode(orderedIds, pathNode, maxFiles);
  }

  if (orderedIds.length === 0) {
    return null;
  }

  const nodes: RuntimeNode[] = orderedIds.flatMap((id, index) => {
      const node = byId.get(id);

      if (!node) {
        return [];
      }

      const runtimeNode: RuntimeNode = {
        id: node.id,
        path: node.path,
        depth: depthOf(node.path),
        parentPath: node.parent,
        runtimeStep: index,
        structuralAncestorIds: structuralAncestorIds(node, byId)
      };

      return [runtimeNode];
    });
  const runtimeNodeIds = new Set(nodes.map((node) => node.id));
  const stepById = new Map(nodes.map((node) => [node.id, node.runtimeStep]));
  const edgesByKey = new Map<string, RuntimeEdge>();

  for (const [index, sourceFile] of dependencyPath.entries()) {
    const targetFile = dependencyPath[index + 1];

    if (!targetFile || !runtimeNodeIds.has(sourceFile.id) || !runtimeNodeIds.has(targetFile.id)) {
      continue;
    }

    const actualImport = graph.edges.find(
      (edge) =>
        (edge.source === sourceFile.id && edge.target === targetFile.id) ||
        (edge.source === targetFile.id && edge.target === sourceFile.id)
    );
    const relationType: RuntimeEdge["relationType"] =
      actualImport?.source === sourceFile.id && actualImport.target === targetFile.id ? "import" : "dependency";
    const edge: RuntimeEdge = {
      source: sourceFile.id,
      target: targetFile.id,
      step: Math.max(stepById.get(sourceFile.id) ?? 0, stepById.get(targetFile.id) ?? 0),
      relationType
    };

    edgesByKey.set(edgeKey(edge.source, edge.target, edge.relationType), edge);
  }

  return {
    originNodeId: origin.id,
    nodes,
    edges: [...edgesByKey.values()].sort((a, b) => a.step - b.step || edgeKey(a.source, a.target, a.relationType).localeCompare(edgeKey(b.source, b.target, b.relationType)))
  };
}
