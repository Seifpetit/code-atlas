import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { AtlasNode } from "../api";

type StructuralKind = "folder" | "file";
type NodeIconName =
  | "folder"
  | "file"
  | "fileText"
  | "settings"
  | "files"
  | "lines"
  | "function"
  | "imports"
  | "react"
  | "code"
  | "dots"
  | "route"
  | "copy";
type FileNodeAction = (node: AtlasNode) => void;

const FUNCTION_METADATA_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py"]);
const SOURCE_ACCENT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);
const TYPESCRIPT_ACCENT_EXTENSIONS = new Set([".ts", ".tsx"]);
const HTML_ACCENT_EXTENSIONS = new Set([".html", ".htm"]);
const CSS_ACCENT_EXTENSIONS = new Set([".css", ".scss"]);
const CONFIG_ACCENT_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".env"]);
const DOCS_ACCENT_EXTENSIONS = new Set([".md", ".mdx"]);
const REACT_FILE_EXTENSIONS = new Set([".tsx", ".jsx"]);

let closeActiveFileMenu: (() => void) | null = null;

interface RelationStubData {
  incomingCount: number;
  outgoingCount: number;
  incomingEdgeIds: string[];
  outgoingEdgeIds: string[];
  incomingFolderRelationCounts?: Record<string, number>;
  outgoingFolderRelationCounts?: Record<string, number>;
  onTraceStart?: (edgeIds: string[], folderRelationCounts?: Record<string, number>) => void;
  onTraceToggle?: (edgeIds: string[], folderRelationCounts?: Record<string, number>) => void;
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
}

function extensionFor(data: AtlasNode): string {
  const metadataExtension = String(data.metadata?.extension ?? "").toLowerCase();

  if (metadataExtension) {
    return metadataExtension;
  }

  const fileName = data.label.toLowerCase();
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return ".env";
  }

  return "";
}

function hasFunctionMetadata(data: AtlasNode): boolean {
  return FUNCTION_METADATA_EXTENSIONS.has(extensionFor(data));
}

function displayedPath(data: AtlasNode, structuralKind: StructuralKind): string {
  if (structuralKind !== "file") {
    return data.path;
  }

  const lastSeparator = Math.max(data.path.lastIndexOf("/"), data.path.lastIndexOf("\\"));
  return lastSeparator >= 0 ? data.path.slice(0, lastSeparator + 1) : "";
}

function fileIconFor(data: AtlasNode): NodeIconName {
  const extension = extensionFor(data);

  if (REACT_FILE_EXTENSIONS.has(extension)) {
    return "react";
  }

  if (CONFIG_ACCENT_EXTENSIONS.has(extension)) {
    return "settings";
  }

  if (DOCS_ACCENT_EXTENSIONS.has(extension)) {
    return "fileText";
  }

  if (SOURCE_ACCENT_EXTENSIONS.has(extension)) {
    return "code";
  }

  return "file";
}

function fileAccentColor(data: AtlasNode, historyBadge?: string): string {
  const extension = extensionFor(data);
  const isHot = historyBadge?.toLowerCase() === "hot";

  if (data.healthTier === "critical") {
    return "#ef4444";
  }

  if (data.healthTier === "warning" && isHot) {
    return "#d97706";
  }

  if (CONFIG_ACCENT_EXTENSIONS.has(extension)) {
    return "#7f77dd";
  }

  if (HTML_ACCENT_EXTENSIONS.has(extension)) {
    return "#f87171";
  }

  if (CSS_ACCENT_EXTENSIONS.has(extension)) {
    return "#f7cf30";
  }

  if (TYPESCRIPT_ACCENT_EXTENSIONS.has(extension)) {
    return "#7dd3fc";
  }

  if (DOCS_ACCENT_EXTENSIONS.has(extension)) {
    return "#06b6d4";
  }

  if (SOURCE_ACCENT_EXTENSIONS.has(extension)) {
    return "#484f58";
  }

  return "#484f58";
}

function healthDotTier(data: AtlasNode): "warning" | "critical" | null {
  if (data.healthTier === "warning" || data.healthTier === "critical") {
    return data.healthTier;
  }

  return null;
}

function NodeIcon({ icon }: { icon: NodeIconName }) {
  if (icon === "folder") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 5h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      </svg>
    );
  }

  if (icon === "fileText") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </svg>
    );
  }

  if (icon === "settings") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8Z" />
        <path d="M4 12h2" />
        <path d="M18 12h2" />
        <path d="M12 4v2" />
        <path d="M12 18v2" />
        <path d="m6.6 6.6 1.4 1.4" />
        <path d="m16 16 1.4 1.4" />
        <path d="m17.4 6.6-1.4 1.4" />
        <path d="m8 16-1.4 1.4" />
      </svg>
    );
  }

  if (icon === "react") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="1.6" />
        <path d="M12 9.4c5.2 0 9.4 1.2 9.4 2.6s-4.2 2.6-9.4 2.6S2.6 13.4 2.6 12 6.8 9.4 12 9.4Z" />
        <path d="M9.7 10.7c2.6-4.5 5.7-7.5 6.9-6.8 1.2.7.1 5-2.5 9.5s-5.7 7.5-6.9 6.8c-1.2-.7-.1-5 2.5-9.5Z" />
        <path d="M9.7 13.3C7.1 8.8 6 4.6 7.2 3.9c1.2-.7 4.3 2.3 6.9 6.8s3.7 8.8 2.5 9.5c-1.2.7-4.3-2.3-6.9-6.9Z" />
      </svg>
    );
  }

  if (icon === "code") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m7 8-4 4 4 4" />
        <path d="m17 8 4 4-4 4" />
        <path d="m14 4-4 16" />
      </svg>
    );
  }

  if (icon === "dots") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 12h.01" />
        <path d="M12 12h.01" />
        <path d="M19 12h.01" />
      </svg>
    );
  }

  if (icon === "route") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 6h4a4 4 0 0 1 0 8h-1a4 4 0 0 0 0 8h5" />
      </svg>
    );
  }

  if (icon === "copy") {
    return (
      <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 8h10a2 2 0 0 1 2 2v10H8Z" />
        <path d="M4 16V4h12" />
      </svg>
    );
  }

  if (icon === "files") {
    return (
      <svg className="atlas-node__icon atlas-node__stat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 7a2 2 0 0 1 2-2h7l3 3v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2Z" />
        <path d="M6 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1" />
      </svg>
    );
  }

  if (icon === "lines") {
    return (
      <svg className="atlas-node__icon atlas-node__stat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 7h14" />
        <path d="M5 12h14" />
        <path d="M5 17h10" />
      </svg>
    );
  }

  if (icon === "function") {
    return (
      <svg className="atlas-node__icon atlas-node__stat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 19c1.5-5.5 2.5-11 4-14" />
        <path d="M6 8h10" />
        <path d="M14 14c1 0 1.5 1 2.5 1s1.5-1 2.5-1" />
      </svg>
    );
  }

  if (icon === "imports") {
    return (
      <svg className="atlas-node__icon atlas-node__stat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 12h12" />
        <path d="m13 8 4 4-4 4" />
      </svg>
    );
  }

  return (
    <svg className="atlas-node__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    </svg>
  );
}

function NodeStat({ icon, children }: { icon: NodeIconName; children: string | number }) {
  return (
    <span className="atlas-node__stat">
      <NodeIcon icon={icon} />
      <span>{children}</span>
    </span>
  );
}

function actionFor(data: AtlasNode, key: "onInspectSource" | "onShowWires"): FileNodeAction | undefined {
  const action = data[key];

  return typeof action === "function" ? action as FileNodeAction : undefined;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    document.execCommand("copy");
  } finally {
    textArea.remove();
  }
}

function FileStatSeparator() {
  return <span className="atlas-node__file-stat-separator" aria-hidden="true">{"\u00b7"}</span>;
}

function FileNodeMenu({ data }: { data: AtlasNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inspectSource = actionFor(data, "onInspectSource");
  const showWires = actionFor(data, "onShowWires");

  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openMenu = useCallback(() => {
    closeActiveFileMenu?.();
    closeActiveFileMenu = closeMenu;
    setIsOpen(true);
  }, [closeMenu]);

  const handleTriggerClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isOpen) {
      closeMenu();
      return;
    }

    openMenu();
  }, [closeMenu, isOpen, openMenu]);

  const runMenuAction = useCallback((event: MouseEvent<HTMLButtonElement>, action: (() => void) | undefined) => {
    event.preventDefault();
    event.stopPropagation();
    action?.();
    closeMenu();
  }, [closeMenu]);

  useEffect(() => {
    if (!isOpen) {
      if (closeActiveFileMenu === closeMenu) {
        closeActiveFileMenu = null;
      }
      return;
    }

    closeActiveFileMenu = closeMenu;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      if (closeActiveFileMenu === closeMenu) {
        closeActiveFileMenu = null;
      }
    };
  }, [closeMenu, isOpen]);

  return (
    <div
      ref={menuRef}
      className={`atlas-node__file-menu ${isOpen ? "is-open" : ""}`.trim()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="atlas-node__file-menu-trigger"
        aria-label="File actions"
        aria-expanded={isOpen}
        onClick={handleTriggerClick}
      >
        <NodeIcon icon="dots" />
      </button>
      {isOpen ? (
        <div className="atlas-node__file-menu-popover" role="menu" aria-label={`${data.label} actions`}>
          <button
            type="button"
            className="atlas-node__file-menu-item"
            role="menuitem"
            onClick={(event) => runMenuAction(event, inspectSource ? () => inspectSource(data) : undefined)}
          >
            <NodeIcon icon="code" />
            <span>Inspect source</span>
          </button>
          <button
            type="button"
            className="atlas-node__file-menu-item"
            role="menuitem"
            onClick={(event) => runMenuAction(event, showWires ? () => showWires(data) : undefined)}
          >
            <NodeIcon icon="route" />
            <span>Show wires</span>
          </button>
          <div className="atlas-node__file-menu-divider" role="separator" />
          <button
            type="button"
            className="atlas-node__file-menu-item"
            role="menuitem"
            onClick={(event) => runMenuAction(event, () => {
              void copyTextToClipboard(data.path);
            })}
          >
            <NodeIcon icon="copy" />
            <span>Copy path</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NodeContent({
  data,
  structuralKind,
  historyBadge
}: NodeChromeProps) {
  const linesOfCode = data.metadata?.linesOfCode;
  const functionCount = data.metadata?.functionCount;
  const shouldShowFunctionCount = hasFunctionMetadata(data) && typeof functionCount === "number";
  const path = displayedPath(data, structuralKind);
  const relationTraceCount = structuralKind === "folder" ? Number(data.relationTraceCount ?? 0) : 0;
  const tier = structuralKind === "file" ? healthDotTier(data) : null;
  const kindIcon = structuralKind === "folder" ? "folder" : fileIconFor(data);
  const extension = extensionFor(data);
  const resolvedLinesOfCode = typeof linesOfCode === "number" ? linesOfCode : 0;
  const resolvedFunctionCount = typeof functionCount === "number" ? functionCount : 0;
  const importedByCount = Number(data.importedByCount ?? 0);
  const shouldShowFileFunctionCount = resolvedFunctionCount > 0;
  const shouldShowImportedByCount = importedByCount > 0;
  const isPressureGhost = data.pressureSimulationGhost === true;
  const pressureSimulationChip = typeof data.pressureSimulationChip === "string" ? data.pressureSimulationChip : "";
  const metaLabel =
    structuralKind === "folder"
      ? `${data.metadata?.childCount ?? 0} items`
      : isPressureGhost && pressureSimulationChip
        ? pressureSimulationChip
        : `${resolvedLinesOfCode} lines of code${shouldShowFileFunctionCount ? `, ${resolvedFunctionCount} functions` : ""}${shouldShowImportedByCount ? `, imported by ${importedByCount}` : ""}`;

  if (structuralKind === "file") {
    return (
      <div className="atlas-node__content atlas-node__content--file">
        {tier ? (
          <span
            className={`atlas-node__health-dot atlas-node__health-dot--${tier}`}
            title={`${tier} health`}
            aria-label={`${tier} health`}
          />
        ) : null}
        <div className="atlas-node__file-kind" aria-label={`${extension || "file"} file`}>
          <NodeIcon icon={kindIcon} />
        </div>
        <div className="atlas-node__label atlas-node__label--file" title={data.label}>{data.label}</div>
        {extension ? <div className="atlas-node__extension" title={extension}>{extension}</div> : null}
        <div className="atlas-node__meta atlas-node__meta--file" aria-label={metaLabel}>
          {isPressureGhost && pressureSimulationChip ? (
            <span className="atlas-node__pressure-chip">{pressureSimulationChip}</span>
          ) : (
            <>
              <span className="atlas-node__file-primary-stat">
                <span className="atlas-node__file-primary-stat-number">{resolvedLinesOfCode}</span>
                <span className="atlas-node__file-primary-stat-unit">L</span>
              </span>
              {shouldShowFileFunctionCount ? (
                <>
                  <FileStatSeparator />
                  <span className="atlas-node__file-secondary-stat">{resolvedFunctionCount}F</span>
                </>
              ) : null}
              {shouldShowImportedByCount ? (
                <>
                  {shouldShowFileFunctionCount ? <FileStatSeparator /> : null}
                  <span className="atlas-node__file-secondary-stat">{importedByCount}in</span>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {relationTraceCount > 0 ? (
        <div
          className="atlas-node__relation-trace-count"
          title={`${relationTraceCount} relationship${relationTraceCount === 1 ? "" : "s"} handled by this folder`}
        >
          {relationTraceCount}
        </div>
      ) : null}
      <div className="atlas-node__content">
        {tier ? (
          <span
            className={`atlas-node__health-dot atlas-node__health-dot--${tier}`}
            title={`${tier} health`}
            aria-label={`${tier} health`}
          />
        ) : null}
        <div className="atlas-node__kind">
          <NodeIcon icon={kindIcon} />
          <span>{structuralKind}</span>
        </div>
        <div className="atlas-node__label" title={data.label}>{data.label}</div>
        {path ? <div className="atlas-node__path" title={path}>{path}</div> : null}
        <div className="atlas-node__meta" aria-label={metaLabel}>
          <div className="atlas-node__stats">
            {structuralKind === "folder" ? (
              <NodeStat icon="files">{data.metadata?.childCount ?? 0}</NodeStat>
            ) : (
              <>
                <NodeStat icon="imports">{data.metadata?.importCount ?? 0}</NodeStat>
                {typeof linesOfCode === "number" ? <NodeStat icon="lines">{`${linesOfCode}L`}</NodeStat> : null}
                {shouldShowFunctionCount ? <NodeStat icon="function">{`${functionCount}F`}</NodeStat> : null}
              </>
            )}
          </div>
          {historyBadge ? <div className="history-badge">{historyBadge}</div> : null}
        </div>
      </div>
    </>
  );
}

function FolderShape(props: NodeChromeProps) {
  return (
    <div className="atlas-node__shape atlas-node__shape--folder">
      <div className="atlas-node__folder-accent" aria-hidden="true" />
      <NodeContent {...props} />
    </div>
  );
}

function FileShape(props: NodeChromeProps) {
  const accentColor = fileAccentColor(props.data, props.historyBadge);

  return (
    <>
      <div className="atlas-node__shape atlas-node__shape--file">
        <svg
          className="atlas-node__file-frame"
          viewBox="0 0 148 102"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            className="atlas-node__file-paper"
            d="M 9 101 Q 1 101 1 93 L 1 18 Q 1 10 9 10 L 132 10 L 147 27 L 147 93 Q 147 101 139 101 Z"
            fill="#0d1117"
            stroke="#1a2332"
            strokeWidth="1"
          />
          <path
            className="atlas-node__file-fold"
            d="M 132 10 L 132 27 L 147 27 Z"
            fill="#161b22"
            stroke="#1a2332"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path
            className="atlas-node__file-accent"
            d="M 9 10 L 132 10 L 147 27"
            fill="none"
            stroke={accentColor}
            strokeWidth="3"
          />
        </svg>
        <NodeContent {...props} />
      </div>
    </>
  );
}

function AtlasNodeCard({ data, structuralKind }: { data: AtlasNode; structuralKind: StructuralKind }) {
  const relationStub = data.relationStub as RelationStubData | undefined;
  const connectionPorts = data.connectionPorts as ConnectionPortsData | undefined;
  const historyBadge = typeof data.historyBadge === "string" ? data.historyBadge : undefined;
  const defaultNodeHeight = structuralKind === "file" ? 102 : 92;
  const viewVariant = typeof data.viewVariant === "string" ? data.viewVariant : "rect";
  const isPressureGhost = data.pressureSimulationGhost === true;
  const refactorRiskLabel = typeof data.refactorRiskLabel === "string" ? data.refactorRiskLabel : "";
  const refactorRiskReasons = Array.isArray(data.refactorRiskReasons)
    ? data.refactorRiskReasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  const className = [
    "atlas-node",
    `atlas-node--${structuralKind}`,
    `atlas-node--${viewVariant}`,
    isPressureGhost ? "atlas-node--pressure-ghost" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const style = {
    "--atlas-node-width": `${Number(data.layoutWidth ?? 210)}px`,
    "--atlas-node-height": `${Number(data.layoutHeight ?? defaultNodeHeight)}px`,
    "--atlas-node-scale": Number(data.layoutScale ?? 1),
    ...(structuralKind === "file"
      ? { "--atlas-file-accent": fileAccentColor(data, historyBadge) }
      : {})
  } as CSSProperties;
  const incomingHasTrace =
    Boolean(relationStub?.incomingEdgeIds.length) ||
    Object.keys(relationStub?.incomingFolderRelationCounts ?? {}).length > 0;
  const outgoingHasTrace =
    Boolean(relationStub?.outgoingEdgeIds.length) ||
    Object.keys(relationStub?.outgoingFolderRelationCounts ?? {}).length > 0;

  return (
    <div
      className={className}
      title={[
        data.path,
        refactorRiskLabel
          ? `${refactorRiskLabel}: ${refactorRiskReasons.join(", ")}`
          : ""
      ].filter(Boolean).join("\n")}
      style={style}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={`atlas-handle atlas-handle--input ${connectionPorts?.input ? "is-connected" : ""} ${incomingHasTrace ? "is-traceable" : ""}`.trim()}
        data-port={connectionPorts?.input ? "I" : undefined}
        title={connectionPorts?.input ? "Incoming connection" : undefined}
        onPointerEnter={() => {
          if (relationStub && incomingHasTrace) {
            relationStub.onTraceStart?.(relationStub.incomingEdgeIds, relationStub.incomingFolderRelationCounts);
          }
        }}
        onPointerLeave={() => {
          if (relationStub && incomingHasTrace) {
            relationStub.onTraceEnd?.();
          }
        }}
      />
      {relationStub?.incomingCount ? (
        <button
          type="button"
          className="relation-stub relation-stub--incoming"
          onClick={() => {
            if (incomingHasTrace) {
              relationStub.onTraceToggle?.(relationStub.incomingEdgeIds, relationStub.incomingFolderRelationCounts);
            }
          }}
          onPointerEnter={() => {
            if (incomingHasTrace) {
              relationStub.onTraceStart?.(relationStub.incomingEdgeIds, relationStub.incomingFolderRelationCounts);
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
        />
      ) : (
        <FolderShape
          data={data}
          structuralKind={structuralKind}
          historyBadge={historyBadge}
        />
      )}
      {structuralKind === "file" && !isPressureGhost ? <FileNodeMenu data={data} /> : null}
      {relationStub?.outgoingCount ? (
        <button
          type="button"
          className="relation-stub relation-stub--outgoing"
          onClick={() => {
            if (outgoingHasTrace) {
              relationStub.onTraceToggle?.(relationStub.outgoingEdgeIds, relationStub.outgoingFolderRelationCounts);
            }
          }}
          onPointerEnter={() => {
            if (outgoingHasTrace) {
              relationStub.onTraceStart?.(relationStub.outgoingEdgeIds, relationStub.outgoingFolderRelationCounts);
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
        className={`atlas-handle atlas-handle--export ${connectionPorts?.export ? "is-connected" : ""} ${outgoingHasTrace ? "is-traceable" : ""}`.trim()}
        data-port={connectionPorts?.export ? "O" : undefined}
        title={connectionPorts?.export ? "Outgoing connection" : undefined}
        onPointerEnter={() => {
          if (relationStub && outgoingHasTrace) {
            relationStub.onTraceStart?.(relationStub.outgoingEdgeIds, relationStub.outgoingFolderRelationCounts);
          }
        }}
        onPointerLeave={() => {
          if (relationStub && outgoingHasTrace) {
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
