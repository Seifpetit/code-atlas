import { MarkerType } from "@xyflow/react";
import type { AtlasGraph, AtlasNode } from "../api";
import type { AtlasFlowEdge, AtlasFlowNode } from "../graph/layout";
import type { RuntimeChain } from "./runtimeTypes";

export interface RuntimeLayoutResult {
  participatingNodeIds: Set<string>;
  revealedNodeIds: Set<string>;
  activeNodeId: string | null;
  previousNodeId: string | null;
  nextNodeId: string | null;
  positions: Map<string, { x: number; y: number }>;
  extraNodes: AtlasFlowNode[];
  edges: AtlasFlowEdge[];
}

const RUNTIME_FILE_WIDTH = 130;
const RUNTIME_FILE_HEIGHT = 180;
const CORRIDOR_STEP_X = 238;
const COLLISION_PADDING = 26;
const COLLISION_MAX_PASSES = 8;

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function runtimeDimensions(node: AtlasNode): { width: number; height: number; scale: number } {
  return { width: RUNTIME_FILE_WIDTH, height: RUNTIME_FILE_HEIGHT, scale: 0.96 };
}

function flowNodeType(node: AtlasNode, baseNode?: AtlasFlowNode): "folder" | "file" {
  if (baseNode?.type === "folder" || baseNode?.type === "file") {
    return baseNode.type;
  }

  return node.type;
}

function nodeDimensions(node: AtlasFlowNode): { width: number; height: number } {
  const data = node.data as AtlasNode;

  return {
    width: Number(data.layoutWidth ?? node.width ?? RUNTIME_FILE_WIDTH),
    height: Number(data.layoutHeight ?? node.height ?? RUNTIME_FILE_HEIGHT)
  };
}

function boundsFor(position: { x: number; y: number }, dimensions: { width: number; height: number }): Bounds {
  return {
    left: position.x - COLLISION_PADDING,
    right: position.x + dimensions.width + COLLISION_PADDING,
    top: position.y - COLLISION_PADDING,
    bottom: position.y + dimensions.height + COLLISION_PADDING
  };
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function pushOutOfObstacle(position: { x: number; y: number }, dimensions: { width: number; height: number }, obstacle: Bounds): { x: number; y: number } {
  const current = boundsFor(position, dimensions);
  const pushRight = obstacle.right - current.left;
  const pushLeft = current.right - obstacle.left;
  const pushDown = obstacle.bottom - current.top;
  const pushUp = current.bottom - obstacle.top;
  const horizontalPush = pushRight < pushLeft ? pushRight : -pushLeft;
  const verticalPush = pushDown < pushUp ? pushDown : -pushUp;

  if (Math.abs(horizontalPush) <= Math.abs(verticalPush)) {
    return {
      x: Math.round(position.x + horizontalPush),
      y: position.y
    };
  }

  return {
    x: position.x,
    y: Math.round(position.y + verticalPush)
  };
}

function resolveRuntimePosition(
  desiredPosition: { x: number; y: number },
  dimensions: { width: number; height: number },
  artifactBounds: Bounds[]
): { x: number; y: number } {
  let position = { ...desiredPosition };

  for (let pass = 0; pass < COLLISION_MAX_PASSES; pass += 1) {
    const collision = artifactBounds.find((artifactBound) => intersects(boundsFor(position, dimensions), artifactBound));

    if (!collision) {
      return position;
    }

    position = pushOutOfObstacle(position, dimensions, collision);
  }

  return position;
}

function nearestBaseNode(
  node: AtlasNode,
  byId: Map<string, AtlasNode>,
  baseById: Map<string, AtlasFlowNode>
): AtlasFlowNode | undefined {
  let cursor: AtlasNode | undefined = node;

  while (cursor) {
    const baseNode = baseById.get(cursor.id);

    if (baseNode) {
      return baseNode;
    }

    cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
  }

  return baseById.values().next().value;
}

function runtimePosition(
  node: AtlasNode,
  step: number,
  originAnchor: { x: number; y: number },
  byId: Map<string, AtlasNode>,
  baseById: Map<string, AtlasFlowNode>
): { x: number; y: number } {
  const baseNode = baseById.get(node.id);
  const anchorNode = nearestBaseNode(node, byId, baseById);
  const anchorPosition = anchorNode?.position ?? originAnchor;
  const depthDrift = Math.min(4, node.path.split("/").length - 1) * 18;
  const corridorTarget = {
    x: originAnchor.x + step * CORRIDOR_STEP_X,
    y: originAnchor.y + 176 + depthDrift
  };

  if (baseNode) {
    if (step === 0) {
      return baseNode.position;
    }

    return {
      x: Math.round(baseNode.position.x * 0.72 + corridorTarget.x * 0.28),
      y: Math.round(baseNode.position.y * 0.72 + corridorTarget.y * 0.28)
    };
  }

  return {
    x: Math.round(anchorPosition.x * 0.32 + corridorTarget.x * 0.68),
    y: Math.round(anchorPosition.y * 0.32 + corridorTarget.y * 0.68)
  };
}

function makeRuntimeNode(
  node: AtlasNode,
  step: number,
  position: { x: number; y: number },
  baseNode?: AtlasFlowNode
): AtlasFlowNode {
  const dimensions = runtimeDimensions(node);

  return {
    id: node.id,
    type: flowNodeType(node, baseNode),
    position,
    width: dimensions.width,
    height: dimensions.height,
    initialWidth: dimensions.width,
    initialHeight: dimensions.height,
    zIndex: 80 + step,
    draggable: true,
    selectable: false,
    data: {
      ...node,
      layoutWidth: dimensions.width,
      layoutHeight: dimensions.height,
      layoutDepth: node.path.split("/").length - 1,
      layoutScale: dimensions.scale,
      viewVariant: "rect",
      runtimeStep: step,
      runtimeRevealed: true
    }
  };
}

function makeRuntimeEdge(edge: RuntimeChain["edges"][number], currentStep: number): AtlasFlowEdge {
  const isActive = edge.step === currentStep;
  const isRecent = edge.step >= currentStep - 2;
  const relationKind = edge.relationType === "structural" ? "runtime-structural" : "runtime-causal";

  return {
    id: `runtime:${edge.relationType}:${edge.source}->${edge.target}:${edge.step}`,
    source: edge.source,
    target: edge.target,
    type: "structural",
    animated: false,
    zIndex: 0,
    data: {
      kind: isActive ? "runtime-active" : relationKind,
      runtimeRelationType: edge.relationType,
      runtimeRecent: isRecent,
      direction: "outgoing"
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: isActive ? "#f8fafc" : edge.relationType === "structural" ? "#7dd3fc" : "#2dd4bf"
    }
  };
}

export function layoutRuntimeCorridor(
  graph: AtlasGraph,
  baseNodes: AtlasFlowNode[],
  chain: RuntimeChain,
  currentStep: number
): RuntimeLayoutResult {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const baseById = new Map(baseNodes.map((node) => [node.id, node]));
  const origin = byId.get(chain.originNodeId);
  const originAnchor = origin ? nearestBaseNode(origin, byId, baseById)?.position ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  const participatingNodeIds = new Set(chain.nodes.map((node) => node.id));
  const revealedRuntimeNodes = chain.nodes.filter((node) => node.runtimeStep <= currentStep);
  const revealedNodeIds = new Set(revealedRuntimeNodes.map((node) => node.id));
  const positions = new Map<string, { x: number; y: number }>();
  const extraNodes: AtlasFlowNode[] = [];
  const runtimeArtifactBounds: Bounds[] = [];

  for (const runtimeNode of revealedRuntimeNodes) {
    const atlasNode = byId.get(runtimeNode.id);

    if (!atlasNode) {
      continue;
    }

    const baseNode = baseById.get(atlasNode.id);
    const dimensions = baseNode ? nodeDimensions(baseNode) : runtimeDimensions(atlasNode);
    const desiredPosition = runtimePosition(atlasNode, runtimeNode.runtimeStep, originAnchor, byId, baseById);
    const position = resolveRuntimePosition(desiredPosition, dimensions, runtimeArtifactBounds);
    positions.set(atlasNode.id, position);
    runtimeArtifactBounds.push(boundsFor(position, dimensions));

    if (!baseNode) {
      extraNodes.push(makeRuntimeNode(atlasNode, runtimeNode.runtimeStep, position));
    }
  }

  const edges = chain.edges
    .filter((edge) => edge.step <= currentStep && revealedNodeIds.has(edge.source) && revealedNodeIds.has(edge.target))
    .filter((edge) => edge.step === currentStep || edge.step >= currentStep - 4)
    .map((edge) => makeRuntimeEdge(edge, currentStep));
  const activeNodeId = chain.nodes.find((node) => node.runtimeStep === currentStep)?.id ?? null;
  const previousNodeId = chain.nodes.find((node) => node.runtimeStep === currentStep - 1)?.id ?? null;
  const nextNodeId = chain.nodes.find((node) => node.runtimeStep === currentStep + 1)?.id ?? null;

  return {
    participatingNodeIds,
    revealedNodeIds,
    activeNodeId,
    previousNodeId,
    nextNodeId,
    positions,
    extraNodes,
    edges
  };
}
