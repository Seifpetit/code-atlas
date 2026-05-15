import { BaseEdge, Position, getSmoothStepPath, type EdgeProps, type EdgeTypes } from "@xyflow/react";

interface StructuralEdgeData extends Record<string, unknown> {
  direction?: "incoming" | "outgoing";
  kind?: string;
  laneOffset?: number;
  mode?: "focus";
}

export function StructuralEdge(props: EdgeProps) {
  const data = props.data as StructuralEdgeData | undefined;
  const laneOffset = Number(data?.laneOffset ?? 0);
  const isLineage = data?.kind === "lineage-chain" || data?.kind === "lineage-child";
  const direction = data?.direction === "incoming" ? "incoming" : "outgoing";
  const mode = isLineage ? "lineage" : "focus";
  const sourceY = props.sourceY + laneOffset;
  const targetY = props.targetY + laneOffset;
  const [edgePath] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX: props.targetX,
    targetY,
    targetPosition: Position.Left,
    borderRadius: 2,
    offset: 34
  });
  const className = [
    "structural-edge",
    isLineage ? "structural-edge--lineage" : `structural-edge--${direction}`,
    data?.kind === "lineage-child" ? "structural-edge--lineage-child" : "",
    `structural-edge--${mode}`,
    props.selected ? "is-selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <BaseEdge
        id={`${props.id}-halo`}
        path={edgePath}
        className={`${className} structural-edge--halo`}
      />
      <BaseEdge
        id={props.id}
        path={edgePath}
        markerEnd={props.markerEnd}
        className={className}
      />
    </>
  );
}

export const edgeTypes: EdgeTypes = {
  structural: StructuralEdge
};
