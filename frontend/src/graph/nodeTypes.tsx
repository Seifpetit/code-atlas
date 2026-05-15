import type { CSSProperties } from "react";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { AtlasNode } from "../api";

type StructuralKind = "domain" | "folder" | "file";

interface RelationStubData {
  incomingCount: number;
  outgoingCount: number;
  firstIncomingEdgeId?: string;
  firstOutgoingEdgeId?: string;
  onTraceStart?: (edgeId: string) => void;
  onTraceEnd?: () => void;
}

function detailFor(data: AtlasNode, structuralKind: StructuralKind): string {
  if (structuralKind === "file") {
    if (data.isImportParsed === false) {
      return `${String(data.fileClusterType ?? "Structural")} file`;
    }

    return `${data.metadata?.importCount ?? 0} imports`;
  }

  return `${data.metadata?.childCount ?? 0} items`;
}

function NodeShell({ data, structuralKind }: { data: AtlasNode; structuralKind: StructuralKind }) {
  const relationStub = data.relationStub as RelationStubData | undefined;
  const viewVariant = typeof data.viewVariant === "string" ? data.viewVariant : "rect";
  const isDomainCard = structuralKind === "domain";
  const isVeryClose = data.isVeryClose === true;
  const className = [
    "atlas-node",
    `atlas-node--${structuralKind}`,
    `atlas-node--${viewVariant}`,
    isDomainCard ? "atlas-node--domain-card" : "",
    isVeryClose ? "atlas-node--very-close" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const style = {
    "--atlas-node-width": `${Number(data.layoutWidth ?? 210)}px`,
    "--atlas-node-height": `${Number(data.layoutHeight ?? 92)}px`,
    "--atlas-node-scale": Number(data.layoutScale ?? 1)
  } as CSSProperties;

  return (
    <div
      className={className}
      title={data.path}
      style={style}
    >
      <Handle type="target" position={Position.Left} className="atlas-handle" />
      {relationStub?.incomingCount ? (
        <button
          type="button"
          className="relation-stub relation-stub--incoming"
          onPointerEnter={() => {
            if (relationStub.firstIncomingEdgeId) {
              relationStub.onTraceStart?.(relationStub.firstIncomingEdgeId);
            }
          }}
          onPointerLeave={() => relationStub.onTraceEnd?.()}
          aria-label={`${relationStub.incomingCount} incoming relationships`}
        >
          <span>&lt;</span>
          {relationStub.incomingCount}
        </button>
      ) : null}
      <div className="atlas-node__kind">{structuralKind}</div>
      <div className="atlas-node__label">{data.label}</div>
      <div className="atlas-node__path">{data.path}</div>
      <div className="atlas-node__meta">{detailFor(data, structuralKind)}</div>
      {relationStub?.outgoingCount ? (
        <button
          type="button"
          className="relation-stub relation-stub--outgoing"
          onPointerEnter={() => {
            if (relationStub.firstOutgoingEdgeId) {
              relationStub.onTraceStart?.(relationStub.firstOutgoingEdgeId);
            }
          }}
          onPointerLeave={() => relationStub.onTraceEnd?.()}
          aria-label={`${relationStub.outgoingCount} outgoing relationships`}
        >
          {relationStub.outgoingCount}
          <span>&gt;</span>
        </button>
      ) : null}
      <Handle type="source" position={Position.Right} className="atlas-handle" />
    </div>
  );
}

export function DomainNode({ data }: NodeProps) {
  return <NodeShell data={data as AtlasNode} structuralKind="domain" />;
}

export function FolderNode({ data }: NodeProps) {
  return <NodeShell data={data as AtlasNode} structuralKind="folder" />;
}

export function FileNode({ data }: NodeProps) {
  return <NodeShell data={data as AtlasNode} structuralKind="file" />;
}

export const nodeTypes: NodeTypes = {
  domain: DomainNode,
  folder: FolderNode,
  file: FileNode
};
