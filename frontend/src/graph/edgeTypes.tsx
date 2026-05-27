import { BaseEdge, getBezierPath, type EdgeProps, type EdgeTypes } from "@xyflow/react";

interface StructuralEdgeData extends Record<string, unknown> {
  direction?: "incoming" | "outgoing";
  kind?: string;
  laneOffset?: number;
}

export function StructuralEdge(props: EdgeProps) {
  const data = props.data as StructuralEdgeData | undefined;
  const laneOffset = Number(data?.laneOffset ?? 0);
  const isLineage = data?.kind === "lineage-chain" || data?.kind === "lineage-child";
  const isRuntime = typeof data?.kind === "string" && data.kind.startsWith("runtime-");
  const direction = data?.direction === "incoming" ? "incoming" : "outgoing";
  const mode = isLineage ? "lineage" : isRuntime ? "runtime" : "focus";
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY + laneOffset,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY + laneOffset,
    targetPosition: props.targetPosition
  });
  const className = [
    "structural-edge",
    isLineage ? "structural-edge--lineage" : isRuntime ? `structural-edge--${data?.kind}` : `structural-edge--${direction}`,
    data?.kind === "lineage-child" ? "structural-edge--lineage-child" : "",
    `structural-edge--${mode}`,
    props.selected ? "is-selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <BaseEdge id={`${props.id}-halo`} path={edgePath} className={`${className} structural-edge--halo`} />
      <BaseEdge id={props.id} path={edgePath} markerEnd={props.markerEnd} className={className} />
    </>
  );
}

export const edgeTypes: EdgeTypes = {
  structural: StructuralEdge
};
