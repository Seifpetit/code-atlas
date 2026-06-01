import type { CSSProperties } from "react";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { AtlasNode } from "../api";
import type { NodeVisualState } from "./attention/attentionTypes";
import { filePaletteForExtension } from "./filePalette";

type StructuralKind = "folder" | "file";
const FUNCTION_METADATA_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py"]);

interface RelationStubData {
  incomingCount: number;
  outgoingCount: number;
  incomingEdgeIds: string[];
  outgoingEdgeIds: string[];
  onTraceStart?: (edgeIds: string[]) => void;
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
  showFolderResidue: boolean;
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

function fileLabelParts(data: AtlasNode): { name: string; extension: string | null } {
  const extension = String(data.metadata?.extension ?? "");

  if (
    extension &&
    data.label.length > extension.length &&
    data.label.toLowerCase().endsWith(extension.toLowerCase())
  ) {
    return {
      name: data.label.slice(0, -extension.length),
      extension
    };
  }

  return { name: data.label, extension: null };
}

function displayedPath(data: AtlasNode, structuralKind: StructuralKind): string {
  if (structuralKind !== "file") {
    return data.path;
  }

  const lastSeparator = Math.max(data.path.lastIndexOf("/"), data.path.lastIndexOf("\\"));
  return lastSeparator >= 0 ? data.path.slice(0, lastSeparator + 1) : "";
}

function NodeContent({
  data,
  structuralKind,
  historyBadge,
  showFolderResidue,
  significanceScore
}: NodeChromeProps) {
  const linesOfCode = data.metadata?.linesOfCode;
  const functionCount = data.metadata?.functionCount;
  const shouldShowMetrics = structuralKind === "file" && typeof linesOfCode === "number";
  const shouldShowFileFooter = structuralKind === "file" && (shouldShowMetrics || Boolean(historyBadge));
  const shouldShowFunctionCount = hasFunctionMetadata(data) && typeof functionCount === "number";
  const path = displayedPath(data, structuralKind);
  const fileLabel = structuralKind === "file" ? fileLabelParts(data) : null;

  return (
    <>
      <div className="atlas-node__kind">{structuralKind}</div>
      {fileLabel ? (
        <div className="atlas-node__label atlas-node__label--file">
          <span className="atlas-node__file-name">{fileLabel.name}</span>
          {fileLabel.extension ? (
            <span className="atlas-node__file-extension">{fileLabel.extension}</span>
          ) : null}
        </div>
      ) : (
        <div className="atlas-node__label">{data.label}</div>
      )}
      {path ? <div className="atlas-node__path">{path}</div> : null}
      {structuralKind === "file" && data.metadata?.staticEntrypoint ? (
        <span className="atlas-node__entrypoint-dot" title="Confirmed static HTML entrypoint" aria-label="Confirmed static HTML entrypoint" />
      ) : null}
      <div className="atlas-node__meta">{detailFor(data, structuralKind)}</div>
      {shouldShowFileFooter ? (
        <div
          className="atlas-node__metrics"
          aria-label={
            shouldShowMetrics
              ? `${linesOfCode} lines of code${shouldShowFunctionCount ? `, ${functionCount} functions` : ""}`
              : "Historical activity"
          }
        >
          {shouldShowMetrics ? (
            <span className="atlas-node__metric-reading">
              <span className="atlas-node__metric-loc">{linesOfCode}L</span>
              {shouldShowFunctionCount ? (
                <>
                  {" "}<span className="atlas-node__metric-separator" aria-hidden="true">&bull;</span>{" "}
                  <span className="atlas-node__metric-functions">{functionCount}F</span>
                </>
              ) : null}
            </span>
          ) : null}
          {historyBadge ? <div className="history-badge history-badge--file">{historyBadge}</div> : null}
        </div>
      ) : null}
      {showFolderResidue ? (
        <div
          className="significance-residue"
          title={`${significanceScore} attention-weighted historical touches inside this folder`}
        />
      ) : null}
      {historyBadge && structuralKind !== "file" ? <div className="history-badge">{historyBadge}</div> : null}
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
      <svg
        className="atlas-node__file-frame"
        viewBox="0 0 130 180"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className="atlas-node__file-fold"
          d="M 104 2 V 16 Q 104 25 113 25 H 128 Z"
        />
        <path
          className="atlas-node__file-outline"
          d="M 11 2 H 101 Q 105 2 108 5 L 125 22 Q 128 25 128 29 V 169 Q 128 178 119 178 H 11 Q 2 178 2 169 V 11 Q 2 2 11 2 Z"
        />
      </svg>
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
  const isVeryClose = data.isVeryClose === true;
  const filePalette = structuralKind === "file"
    ? filePaletteForExtension(data.metadata?.extension)
    : null;
  const showFolderResidue =
    structuralKind === "folder" &&
    (
      visualState?.layer === "structural-guidance" ||
      visualState?.layer === "temporal-pressure" ||
      visualState?.layer === "critical-event"
    );
  const className = [
    "atlas-node",
    `atlas-node--${structuralKind}`,
    `atlas-node--${viewVariant}`,
    filePalette ? `atlas-node--palette-${filePalette}` : "",
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
        className={`atlas-handle atlas-handle--input ${connectionPorts?.input ? "is-connected" : ""} ${relationStub?.incomingEdgeIds.length ? "is-traceable" : ""}`.trim()}
        data-port={connectionPorts?.input ? "I" : undefined}
        title={connectionPorts?.input ? "Incoming connection" : undefined}
        onPointerEnter={() => {
          if (relationStub?.incomingEdgeIds.length) {
            relationStub.onTraceStart?.(relationStub.incomingEdgeIds);
          }
        }}
        onPointerLeave={() => {
          if (relationStub?.incomingEdgeIds.length) {
            relationStub.onTraceEnd?.();
          }
        }}
      />
      {relationStub?.incomingCount ? (
        <button
          type="button"
          className="relation-stub relation-stub--incoming"
          onPointerEnter={() => {
            if (relationStub.incomingEdgeIds.length) {
              relationStub.onTraceStart?.(relationStub.incomingEdgeIds);
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
          showFolderResidue={showFolderResidue}
          significanceScore={significanceScore}
        />
      ) : (
        <FolderShape
          data={data}
          structuralKind={structuralKind}
          historyBadge={historyBadge}
          showFolderResidue={showFolderResidue}
          significanceScore={significanceScore}
        />
      )}
      {relationStub?.outgoingCount ? (
        <button
          type="button"
          className="relation-stub relation-stub--outgoing"
          onPointerEnter={() => {
            if (relationStub.outgoingEdgeIds.length) {
              relationStub.onTraceStart?.(relationStub.outgoingEdgeIds);
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
        className={`atlas-handle atlas-handle--export ${connectionPorts?.export ? "is-connected" : ""} ${relationStub?.outgoingEdgeIds.length ? "is-traceable" : ""}`.trim()}
        data-port={connectionPorts?.export ? "O" : undefined}
        title={connectionPorts?.export ? "Outgoing connection" : undefined}
        onPointerEnter={() => {
          if (relationStub?.outgoingEdgeIds.length) {
            relationStub.onTraceStart?.(relationStub.outgoingEdgeIds);
          }
        }}
        onPointerLeave={() => {
          if (relationStub?.outgoingEdgeIds.length) {
            relationStub.onTraceEnd?.();
          }
        }}
      />
    </div>
  );
}

export function FolderNode({ data }: NodeProps) {
  return <AtlasNodeCard data={data as AtlasNode} structuralKind="folder" />;
}

export function FileNode({ data }: NodeProps) {
  return <AtlasNodeCard data={data as AtlasNode} structuralKind="file" />;
}

export const nodeTypes: NodeTypes = {
  folder: FolderNode,
  file: FileNode
};
