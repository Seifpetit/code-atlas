import path from "node:path";
import type { ExtractedStructure, GraphEdge, GraphJson, GraphNode } from "./types.js";

function labelFromPath(nodePath: string): string {
  return nodePath === "." ? "." : path.posix.basename(nodePath);
}

function parentFromPath(nodePath: string): string | undefined {
  const parent = path.posix.dirname(nodePath);
  return parent === "." ? undefined : parent;
}

export function buildGraph(structure: ExtractedStructure): GraphJson {
  const importCounts = new Map<string, number>();
  const childCounts = new Map<string, number>();

  for (const filePath of structure.files) {
    const parent = parentFromPath(filePath);
    if (parent) {
      childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    }
  }

  for (const folderPath of structure.folders) {
    const parent = parentFromPath(folderPath);
    if (parent) {
      childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
    }
  }

  for (const importEdge of structure.imports) {
    importCounts.set(importEdge.source, (importCounts.get(importEdge.source) ?? 0) + 1);
  }

  const folderNodes: GraphNode[] = [...structure.folders]
    .sort()
    .map((folderPath) => ({
      id: folderPath,
      type: "folder",
      label: labelFromPath(folderPath),
      path: folderPath,
      parent: parentFromPath(folderPath),
      metadata: {
        childCount: childCounts.get(folderPath) ?? 0
      }
    }));

  const fileNodes: GraphNode[] = [...structure.files]
    .sort()
    .map((filePath) => ({
      id: filePath,
      type: "file",
      label: labelFromPath(filePath),
      path: filePath,
      parent: parentFromPath(filePath),
      metadata: {
        extension: path.posix.extname(filePath),
        importCount: importCounts.get(filePath) ?? 0
      }
    }));

  const edges: GraphEdge[] = structure.imports
    .slice()
    .sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`))
    .map((importEdge, index) => ({
      id: `edge-${index + 1}`,
      source: importEdge.source,
      target: importEdge.target,
      type: "import"
    }));

  return {
    nodes: [...folderNodes, ...fileNodes],
    edges
  };
}
