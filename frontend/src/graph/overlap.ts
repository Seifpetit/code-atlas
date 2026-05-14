import type { AtlasNode } from "../api";
import type { AtlasFlowNode } from "./layout";

export const VERY_CLOSE_DISTANCE = 12;

const FALLBACK_RECT_NODE_WIDTH = 210;
const FALLBACK_RECT_NODE_HEIGHT = 92;

interface Bounds {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function nodeSize(node: AtlasFlowNode): { width: number; height: number } {
  const data = node.data as AtlasNode;
  return {
    width: Number(data.layoutWidth ?? FALLBACK_RECT_NODE_WIDTH),
    height: Number(data.layoutHeight ?? FALLBACK_RECT_NODE_HEIGHT)
  };
}

function boundsFor(node: AtlasFlowNode): Bounds {
  const size = nodeSize(node);

  return {
    id: node.id,
    left: node.position.x,
    right: node.position.x + size.width,
    top: node.position.y,
    bottom: node.position.y + size.height
  };
}

function expandedBoundsFor(node: AtlasFlowNode): Bounds {
  const bounds = boundsFor(node);

  return {
    id: bounds.id,
    left: bounds.left - VERY_CLOSE_DISTANCE,
    right: bounds.right + VERY_CLOSE_DISTANCE,
    top: bounds.top - VERY_CLOSE_DISTANCE,
    bottom: bounds.bottom + VERY_CLOSE_DISTANCE
  };
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function verticalPushDistance(a: Bounds, b: Bounds): number {
  return a.bottom + VERY_CLOSE_DISTANCE - b.top;
}

function markVeryClose(nodes: AtlasFlowNode[]): Set<string> {
  const closeNodeIds = new Set<string>();

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (intersects(expandedBoundsFor(nodes[i]), expandedBoundsFor(nodes[j]))) {
        closeNodeIds.add(nodes[i].id);
        closeNodeIds.add(nodes[j].id);
      }
    }
  }

  return closeNodeIds;
}

export function resolveOverlaps(nodes: AtlasFlowNode[]): { nodes: AtlasFlowNode[]; veryCloseNodeIds: Set<string> } {
  const veryCloseNodeIds = markVeryClose(nodes);
  const resolvedNodes = nodes.map((node) => ({
    ...node,
    position: { ...node.position }
  }));
  const contentNodes = resolvedNodes
    .slice()
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));

  for (let pass = 0; pass < contentNodes.length; pass += 1) {
    let changed = false;

    for (let i = 0; i < contentNodes.length; i += 1) {
      for (let j = i + 1; j < contentNodes.length; j += 1) {
        const current = expandedBoundsFor(contentNodes[i]);
        const candidate = expandedBoundsFor(contentNodes[j]);

        if (!intersects(current, candidate)) {
          continue;
        }

        const pushDistance = verticalPushDistance(current, candidate);
        if (pushDistance <= 0) {
          continue;
        }

        contentNodes[j].position.y += pushDistance;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return {
    nodes: resolvedNodes,
    veryCloseNodeIds
  };
}
