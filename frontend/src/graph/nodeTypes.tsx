import type { CSSProperties } from "react";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { AtlasNode } from "../api";
import type { NodeVisualState } from "./attention/attentionTypes";

type StructuralKind = "domain" | "folder" | "file";
const FUNCTION_METADATA_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py"]);

interface RelationStubData {
  incomingCount: number;
  outgoingCount: number;
  firstIncomingEdgeId?: string;
  firstOutgoingEdgeId?: string;
  onTraceStart?: (edgeId: string) => void;
  onTraceEnd?: () => void;
}

interface ConnectionPortsData {
  input: boolean;
  export: boolean;
}

interface NodeChromeProps {
  data: AtlasNode;
  structuralKind: StructuralKind;
  historyBadge?: string;
  shouldShowResidue: boolean;
  significanceScore: number;
}

function hasFunctionMetadata(data: AtlasNode): boolean {
  return FUNCTION_METADATA_EXTENSIONS.has(String(data.metadata?.extension ?? "").toLowerCase());
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

function NodeContent({
  data,
  structuralKind,
  historyBadge,
  shouldShowResidue,
  significanceScore
}: NodeChromeProps) {
  const linesOfCode = data.metadata?.linesOfCode;
  const functionCount = data.metadata?.functionCount;
  const shouldShowMetrics = structuralKind === "file" && typeof linesOfCode === "number";
  const shouldShowFunctionCount = hasFunctionMetadata(data) && typeof functionCount === "number";

  return (
    <>
      <div className="atlas-node__kind">{structuralKind}</div>
      <div className="atlas-node__label">{data.label}</div>
      <div className="atlas-node__path">{data.path}</div>
      <div className="atlas-node__meta">{detailFor(data, structuralKind)}</div>
      {shouldShowMetrics ? (
        <div
          className="atlas-node__metrics"
          aria-label={`${linesOfCode} lines of code${shouldShowFunctionCount ? `, ${functionCount} functions` : ""}`}
        >
          {linesOfCode}L
          {shouldShowFunctionCount ? (
            <>
              {" "}<span aria-hidden="true">&bull;</span>{" "}{functionCount}F
            </>
          ) : null}
        </div>
      ) : null}
      {shouldShowResidue ? (
        <div
          className="significance-residue"
          title={`${significanceScore} attention-weighted historical touches inside this structural area`}
        />
      ) : null}
      {historyBadge ? <div className="history-badge">{historyBadge}</div> : null}
    </>
  );
}

function FolderShape(props: NodeChromeProps) {
  return (
    <div className="atlas-node__shape atlas-node__shape--folder">
      <div className="atlas-node__folder-tab" />
      <NodeContent {...props} />
    </div>
  );
}

function FileShape(props: NodeChromeProps) {
  return (
    <div className="atlas-node__shape atlas-node__shape--file">
      <div className="atlas-node__file-fold" />
      <NodeContent {...props} />
    </div>
  );
}

function AtlasNodeCard({ data, structuralKind }: { data: AtlasNode; structuralKind: StructuralKind }) {
  const relationStub = data.relationStub as RelationStubData | undefined;
  const connectionPorts = data.connectionPorts as ConnectionPortsData | undefined;
  const historyBadge = typeof data.historyBadge === "string" ? data.historyBadge : undefined;
  const significanceScore = Number(data.significanceScore ?? 0);
  const visualState = data.visualState as NodeVisualState | undefined;
  const viewVariant = typeof data.viewVariant === "string" ? data.viewVariant : "rect";
  const isDomainCard = structuralKind === "domain";
  const isVeryClose = data.isVeryClose === true;
  const shouldShowResidue =
    visualState?.layer === "structural-guidance" ||
    visualState?.layer === "temporal-pressure" ||
    visualState?.layer === "critical-event";
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
      <Handle
        type="target"
        position={Position.Left}
        className={`atlas-handle atlas-handle--input ${connectionPorts?.input ? "is-connected" : ""}`.trim()}
        data-port={connectionPorts?.input ? "I" : undefined}
        title={connectionPorts?.input ? "Incoming connection" : undefined}
      />
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
      {structuralKind === "file" ? (
        <FileShape
          data={data}
          structuralKind={structuralKind}
          historyBadge={historyBadge}
          shouldShowResidue={shouldShowResidue}
          significanceScore={significanceScore}
        />
      ) : (
        <FolderShape
          data={data}
          structuralKind={structuralKind}
          historyBadge={historyBadge}
          shouldShowResidue={shouldShowResidue}
          significanceScore={significanceScore}
        />
      )}
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
      <Handle
        type="source"
        position={Position.Right}
        className={`atlas-handle atlas-handle--export ${connectionPorts?.export ? "is-connected" : ""}`.trim()}
        data-port={connectionPorts?.export ? "O" : undefined}
        title={connectionPorts?.export ? "Outgoing connection" : undefined}
      />
    </div>
  );
}

export function DomainNode({ data }: NodeProps) {
  return <AtlasNodeCard data={data as AtlasNode} structuralKind="domain" />;
}

export function FolderNode({ data }: NodeProps) {
  return <AtlasNodeCard data={data as AtlasNode} structuralKind="folder" />;
}

export function FileNode({ data }: NodeProps) {
  return <AtlasNodeCard data={data as AtlasNode} structuralKind="file" />;
}

export const nodeTypes: NodeTypes = {
  domain: DomainNode,
  folder: FolderNode,
  file: FileNode
};
