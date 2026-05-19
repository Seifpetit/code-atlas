import { BaseEdge, type EdgeProps, type EdgeTypes } from "@xyflow/react";

interface StructuralEdgeData extends Record<string, unknown> {
  direction?: "incoming" | "outgoing";
  kind?: string;
  laneOffset?: number;
}

function straightPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
}

export function StructuralEdge(props: EdgeProps) {
  const data = props.data as StructuralEdgeData | undefined;
  const laneOffset = Number(data?.laneOffset ?? 0);
  const isLineage = data?.kind === "lineage-chain" || data?.kind === "lineage-child";
  const isRuntime = typeof data?.kind === "string" && data.kind.startsWith("runtime-");
  const direction = data?.direction === "incoming" ? "incoming" : "outgoing";
  const mode = isLineage ? "lineage" : isRuntime ? "runtime" : "focus";
  const edgePath = straightPath(
    props.sourceX,
    props.sourceY + laneOffset,
    props.targetX,
    props.targetY + laneOffset
  );
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
