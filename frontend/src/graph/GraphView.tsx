import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  ReactFlow,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowInstance
} from "@xyflow/react";
import type { AtlasGraph, AtlasNode } from "../api";
import { historyBadgeFor } from "../history/historyUtils";
import { extractArchitecturalLandmarks, snapToLandmark } from "../time/landmarkExtraction";
import { RawHistoryInspector } from "../time/RawHistoryInspector";
import { TemporalScrubber } from "../time/TemporalScrubber";
import { buildTemporalStates, nodeTemporalPressure, temporalPressureLevel } from "../time/temporalPressure";
import { buildRuntimeChain } from "../runtime/buildRuntimeChain";
import { layoutRuntimeCorridor } from "../runtime/runtimeLayout";
import { RuntimeScrubber } from "../runtime/RuntimeScrubber";
import { inactiveRuntimeState, type RuntimeState } from "../runtime/runtimeTypes";
import { runtimeVisualState } from "../runtime/runtimeVisualState";
import { RuntimeXRayOverlay } from "../runtime/RuntimeXRayOverlay";
import { visualStateStyle } from "./attention/applyNodeVisualState";
import { composeNodeVisualState } from "./attention/composeNodeVisualState";
import type { ClusteringMode } from "./clustering";
import { edgeTypes } from "./edgeTypes";
import { layoutStructuralContext, type AtlasFlowEdge, type AtlasFlowNode } from "./layout";
import { nodeTypes } from "./nodeTypes";

interface GraphViewProps {
  graph: AtlasGraph | null;
  searchTerm: string;
  clusteringMode: ClusteringMode;
}

interface StructuralState {
  currentContextId: string | null;
  focusedNodeId: string | null;
  tracedEdgeId: string | null;
  pageIndex: number;
  breadcrumbPath: string[];
  clusteringMode: ClusteringMode;
}

interface BudgetedRelationship {
  edge: AtlasFlowEdge;
  direction: "incoming" | "outgoing";
  otherNode: AtlasNode | null;
  score: number;
}

type ManualNodePositions = Record<string, { x: number; y: number }>;

const COMPRESSION_REASON_LABELS = new Map<string, string>([
  ["very-low-loc", "very low LOC"],
  ["tiny-wrapper", "tiny wrapper"],
  ["conventional-support-file", "support file convention"],
  ["pass-through-export", "pass-through exports"]
]);
const JAVASCRIPT_ECOSYSTEM_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
type ArchitecturalWeight = "LOW" | "MEDIUM" | "HIGH";
type OperationalRoleKind =
  | "low-signal"
  | "configuration"
  | "support"
  | "gateway"
  | "dependency-hub"
  | "runtime"
  | "rendering"
  | "leaf"
  | "isolated"
  | "connected";

interface OperationalRole {
  kind: OperationalRoleKind;
  label: string;
}

interface RegionalSummary {
  directChildCount: number;
  fileCount: number;
  folderCount: number;
  totalLinesOfCode?: number;
  totalFunctionCount?: number;
  lowSignalFileCount: number;
  configurationFileCount: number;
  internalImports: number;
  inboundImports: number;
  outboundImports: number;
}

function compressionDescription(node: AtlasNode): string {
  const reasons = node.metadata?.compressionReasons ?? [];
  return reasons
    .map((reason) => COMPRESSION_REASON_LABELS.get(reason) ?? reason)
    .join(", ");
}

function isJavaScriptEcosystemFile(node: AtlasNode): boolean {
  return JAVASCRIPT_ECOSYSTEM_EXTENSIONS.has(String(node.metadata?.extension ?? "").toLowerCase());
}

function panelObjectType(node: AtlasNode): "FILE" | "FOLDER" | "DOMAIN" {
  if (node.type === "file") {
    return "FILE";
  }

  return node.parent ? "FOLDER" : "DOMAIN";
}

function panelTitle(node: AtlasNode): string {
  return node.type === "file" ? node.label : `${node.label}/`;
}

function orientationPath(node: AtlasNode): string {
  if (node.type === "file") {
    return node.parent ? `${node.parent}/` : "repository root/";
  }

  return node.parent ? `${node.path}/` : "repository root/";
}

function fileStem(node: AtlasNode): string {
  const extension = String(node.metadata?.extension ?? "");
  return extension && node.label.endsWith(extension)
    ? node.label.slice(0, -extension.length).toLowerCase()
    : node.label.toLowerCase();
}

function architecturalWeightFor(node: AtlasNode, importedByCount: number): ArchitecturalWeight {
  const linesOfCode = Number(node.metadata?.linesOfCode ?? 0);
  const functionCount = Number(node.metadata?.functionCount ?? 0);
  const imports = Number(node.metadata?.importCount ?? 0);
  let score = 0;

  score += linesOfCode >= 300 ? 3 : linesOfCode >= 100 ? 2 : linesOfCode >= 30 ? 1 : 0;
  score += functionCount >= 12 ? 3 : functionCount >= 5 ? 2 : functionCount >= 2 ? 1 : 0;
  score += imports >= 8 ? 2 : imports >= 3 ? 1 : 0;
  score += importedByCount >= 8 ? 3 : importedByCount >= 3 ? 2 : importedByCount > 0 ? 1 : 0;

  if (score >= 7) {
    return "HIGH";
  }

  return score >= 3 ? "MEDIUM" : "LOW";
}

function operationalRolesFor(node: AtlasNode, importedByCount: number): OperationalRole[] {
  const stem = fileStem(node);
  const imports = Number(node.metadata?.importCount ?? 0);
  const normalizedPath = node.path.toLowerCase();
  const roles: OperationalRole[] = [];

  if (node.metadata?.compressionLevel === "low-signal") {
    roles.push({ kind: "low-signal", label: "Rule-classified low-signal file" });
  }

  if (stem === "config") {
    roles.push({ kind: "configuration", label: "Configuration file" });
  } else if (stem === "types" || stem === "constants") {
    roles.push({ kind: "support", label: "Structural support file" });
  } else if (stem === "index") {
    roles.push({ kind: "gateway", label: "Index or export gateway" });
  }

  if (importedByCount >= 5) {
    roles.push({ kind: "dependency-hub", label: "Dependency hub candidate" });
  }

  if (/(^|[\/_-])runtime([\/_.-]|$)/.test(normalizedPath)) {
    roles.push({ kind: "runtime", label: "Runtime-related candidate" });
  } else if (/(graph|layout|render|projection|component|view)/.test(normalizedPath)) {
    roles.push({ kind: "rendering", label: "Rendering or projection candidate" });
  }

  if (roles.length === 0 && imports === 0 && importedByCount > 0) {
    roles.push({ kind: "leaf", label: "Leaf dependency candidate" });
  }

  if (roles.length === 0) {
    roles.push(
      imports === 0 && importedByCount === 0
        ? { kind: "isolated", label: "Unconnected implementation file" }
        : { kind: "connected", label: "Connected implementation file" }
    );
  }

  return roles.filter((role, index) => roles.findIndex((candidate) => candidate.kind === role.kind) === index).slice(0, 2);
}

function regionalSummaryFor(region: AtlasNode, graph: AtlasGraph): RegionalSummary {
  const files = graph.nodes.filter((node) => node.type === "file" && ownsPath(region, node.path));
  const folders = graph.nodes.filter((node) => node.type === "folder" && node.id !== region.id && ownsPath(region, node.path));
  const javascriptFiles = files.filter(isJavaScriptEcosystemFile);
  const totalLinesOfCode = files.length > 0 && files.every((node) => typeof node.metadata?.linesOfCode === "number")
    ? files.reduce((total, node) => total + Number(node.metadata?.linesOfCode), 0)
    : undefined;
  const totalFunctionCount = javascriptFiles.length > 0 &&
      javascriptFiles.every((node) => typeof node.metadata?.functionCount === "number")
    ? javascriptFiles.reduce((total, node) => total + Number(node.metadata?.functionCount), 0)
    : undefined;
  let internalImports = 0;
  let inboundImports = 0;
  let outboundImports = 0;

  for (const edge of graph.edges) {
    const sourceOwned = ownsPath(region, edge.source);
    const targetOwned = ownsPath(region, edge.target);

    if (sourceOwned && targetOwned) {
      internalImports += 1;
    } else if (sourceOwned) {
      outboundImports += 1;
    } else if (targetOwned) {
      inboundImports += 1;
    }
  }

  return {
    directChildCount: Number(region.metadata?.childCount ?? 0),
    fileCount: files.length,
    folderCount: folders.length,
    totalLinesOfCode,
    totalFunctionCount,
    lowSignalFileCount: files.filter((node) => node.metadata?.compressionLevel === "low-signal").length,
    configurationFileCount: files.filter((node) => ["config", "constants", "types"].includes(fileStem(node))).length,
    internalImports,
    inboundImports,
    outboundImports
  };
}

function dominantGravityFor(summary: RegionalSummary): { label: string; detail?: string } {
  if (summary.fileCount === 0) {
    return { label: "Structural container", detail: "No indexed files in this region." };
  }

  if (summary.lowSignalFileCount >= 2 && summary.lowSignalFileCount / summary.fileCount >= 0.5) {
    return {
      label: "Mostly low-signal files",
      detail: `${summary.lowSignalFileCount} of ${summary.fileCount} files are rule-classified low-signal.`
    };
  }

  if (summary.configurationFileCount >= 2 && summary.configurationFileCount / summary.fileCount >= 0.5) {
    return {
      label: "Mostly configuration and support",
      detail: `${summary.configurationFileCount} conventionally named support files detected.`
    };
  }

  if (summary.inboundImports + summary.outboundImports >= Math.max(5, summary.fileCount)) {
    return {
      label: "Dependency concentration candidate",
      detail: `${summary.inboundImports} inbound and ${summary.outboundImports} outbound boundary imports.`
    };
  }

  if (summary.fileCount >= 10 && summary.fileCount >= (summary.folderCount + 1) * 3) {
    return {
      label: "High file density",
      detail: `${summary.fileCount} files across ${summary.folderCount} nested folders.`
    };
  }

  return {
    label: "Mixed implementation region",
    detail: summary.internalImports > 0 ? `${summary.internalImports} parsed import connections remain inside this region.` : undefined
  };
}

function isLineageNode(node: AtlasFlowNode): boolean {
  const data = node.data as AtlasNode;

  return typeof data.lineageKind === "string";
}

function isStructuralNode(node: AtlasFlowNode): node is AtlasFlowNode {
  const data = node.data as AtlasNode;

  if (isLineageNode(node)) {
    return false;
  }

  return node.type === "domain" || node.type === "folder" || node.type === "file";
}

function canEnter(node: AtlasNode): boolean {
  return node.type === "folder" && Number(node.metadata?.childCount ?? 0) > 0;
}

function ownsPath(owner: AtlasNode, path: string): boolean {
  if (owner.type === "file") {
    return owner.path === path;
  }

  return path === owner.path || path.startsWith(`${owner.path}/`);
}

function laneOffsetFor(index: number, total: number): number {
  const laneGap = 14;
  return (index - (total - 1) / 2) * laneGap;
}

function relationshipScore(activeNode: AtlasNode, otherNode: AtlasNode | null): number {
  if (!otherNode) {
    return 0;
  }

  if ((activeNode.parent ?? null) === (otherNode.parent ?? null)) {
    return 300;
  }

  return 200;
}

function budgetRelationships(
  allEdges: AtlasFlowEdge[],
  visibleById: Map<string, AtlasNode>,
  activeNodeId: string,
  limit: number
): {
  visible: BudgetedRelationship[];
  hiddenIncoming: number;
  hiddenOutgoing: number;
  totalIncoming: number;
  totalOutgoing: number;
} {
  const activeNode = visibleById.get(activeNodeId);
  const related = allEdges
    .filter((edge) => edge.source === activeNodeId || edge.target === activeNodeId)
    .map((edge) => {
      const direction: "incoming" | "outgoing" = edge.source === activeNodeId ? "outgoing" : "incoming";
      const otherNode = visibleById.get(direction === "outgoing" ? edge.target : edge.source) ?? null;
      const importCount = Number(edge.data?.importCount ?? 1);

      return {
        edge,
        direction,
        otherNode,
        score: (activeNode ? relationshipScore(activeNode, otherNode) : 0) + importCount
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.direction !== b.direction) {
        return a.direction === "outgoing" ? -1 : 1;
      }

      return (a.otherNode?.path ?? a.edge.id).localeCompare(b.otherNode?.path ?? b.edge.id);
    });
  const visible = related.slice(0, limit);
  const hidden = related.slice(limit);

  return {
    visible,
    hiddenIncoming: hidden.filter((relation) => relation.direction === "incoming").length,
    hiddenOutgoing: hidden.filter((relation) => relation.direction === "outgoing").length,
    totalIncoming: related.filter((relation) => relation.direction === "incoming").length,
    totalOutgoing: related.filter((relation) => relation.direction === "outgoing").length
  };
}

export function GraphView({ graph, searchTerm, clusteringMode }: GraphViewProps) {
  const [selectedNode, setSelectedNode] = useState<AtlasNode | null>(null);
  const [currentContextId, setCurrentContextId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [tracedEdgeId, setTracedEdgeId] = useState<string | null>(null);
  const [selectedRuntimeFileId, setSelectedRuntimeFileId] = useState<string | null>(null);
  const [temporalIndex, setTemporalIndex] = useState(0);
  const [focusedLandmarkId, setFocusedLandmarkId] = useState<string | null>(null);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [manualNodePositions, setManualNodePositions] = useState<ManualNodePositions>({});
  const [runtimeNodePositions, setRuntimeNodePositions] = useState<ManualNodePositions>({});
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<AtlasFlowNode, AtlasFlowEdge> | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(inactiveRuntimeState);
  const [runtimePlaybackActive, setRuntimePlaybackActive] = useState(false);
  const laidOut = useMemo(
    () => (graph ? layoutStructuralContext(graph, currentContextId, pageIndex) : null),
    [currentContextId, graph, pageIndex]
  );
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const handleTraceStart = useCallback((edgeId: string) => {
    setTracedEdgeId(edgeId);
  }, []);
  const handleTraceEnd = useCallback(() => {
    setTracedEdgeId(null);
  }, []);

  const structuralState = useMemo<StructuralState | null>(() => {
    if (!laidOut) {
      return null;
    }

    return {
      currentContextId,
      focusedNodeId,
      tracedEdgeId,
      pageIndex: laidOut.currentPage,
      breadcrumbPath: laidOut.breadcrumbPath.map((item) => item.id ?? "root"),
      clusteringMode
    };
  }, [clusteringMode, currentContextId, focusedNodeId, laidOut, tracedEdgeId]);

  useEffect(() => {
    setCurrentContextId(null);
    setHoveredNodeId(null);
    setFocusedNodeId(null);
    setTracedEdgeId(null);
    setSelectedRuntimeFileId(null);
    setTemporalIndex(0);
    setFocusedLandmarkId(null);
    setSelectedNode(null);
    setPageIndex(0);
    setManualNodePositions({});
    setRuntimeNodePositions({});
    setRuntimeState(inactiveRuntimeState);
    setRuntimePlaybackActive(false);
  }, [graph]);

  useEffect(() => {
    setFocusedNodeId(null);
    setHoveredNodeId(null);
    setTracedEdgeId(null);
    setSelectedRuntimeFileId(null);
    setSelectedNode(null);
    setPageIndex(0);
    setRuntimeNodePositions({});
    setRuntimeState(inactiveRuntimeState);
    setRuntimePlaybackActive(false);
  }, [currentContextId]);

  useEffect(() => {
    if (!laidOut || pageIndex === laidOut.currentPage) {
      return;
    }

    setPageIndex(laidOut.currentPage);
  }, [laidOut, pageIndex]);

  useEffect(() => {
    if (!reactFlowInstance || !laidOut) {
      return;
    }

    window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({ padding: 0.24, duration: 420 });
    });
  }, [laidOut, reactFlowInstance, runtimeState.active, runtimeState.currentStep, temporalIndex]);

  useEffect(() => {
    if (!runtimePlaybackActive || !runtimeState.active || !runtimeState.chain) {
      return;
    }

    const maxStep = Math.max(0, runtimeState.chain.nodes.length - 1);

    if (runtimeState.currentStep >= maxStep) {
      setRuntimePlaybackActive(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRuntimeState((current) => {
        if (!current.active || !current.chain) {
          return current;
        }

        return {
          ...current,
          currentStep: Math.min(current.currentStep + 1, Math.max(0, current.chain.nodes.length - 1))
        };
      });
    }, 720);

    return () => window.clearTimeout(timeoutId);
  }, [runtimePlaybackActive, runtimeState]);

  const commits = graph?.commits ?? [];
  const temporalStates = useMemo(() => (graph ? buildTemporalStates(graph, commits) : []), [commits, graph]);
  const temporalLandmarks = useMemo(
    () => extractArchitecturalLandmarks(commits, temporalStates),
    [commits, temporalStates]
  );
  const activeTemporalState = useMemo(() => temporalStates[temporalIndex] ?? null, [temporalIndex, temporalStates]);
  const activeTemporalDate = useMemo(() => {
    return activeTemporalState?.date ?? commits[0]?.date ?? new Date().toISOString();
  }, [activeTemporalState, commits]);
  const focusedLandmark = useMemo(() => {
    return temporalLandmarks.find((landmark) => landmark.id === focusedLandmarkId) ?? null;
  }, [focusedLandmarkId, temporalLandmarks]);
  const displayedLayoutNodes = useMemo(() => {
    if (!laidOut) {
      return [];
    }
    return laidOut.nodes;
  }, [laidOut]);
  const visibleById = useMemo(() => {
    return new Map(displayedLayoutNodes.map((node) => [node.id, node.data as AtlasNode]));
  }, [displayedLayoutNodes]);
  const graphNodeById = useMemo(() => {
    return new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  }, [graph]);
  const runtimeLayout = useMemo(() => {
    if (!graph || !runtimeState.active || !runtimeState.chain) {
      return null;
    }

    return layoutRuntimeCorridor(graph, displayedLayoutNodes, runtimeState.chain, runtimeState.currentStep);
  }, [displayedLayoutNodes, graph, runtimeState]);
  const handleNodesChange = useCallback((changes: NodeChange<AtlasFlowNode>[]) => {
    if (runtimeState.active && runtimeLayout) {
      setRuntimeNodePositions((currentPositions) => {
        let nextPositions = currentPositions;

        for (const change of changes) {
          if (change.type === "position" && change.position && runtimeLayout.revealedNodeIds.has(change.id)) {
            if (nextPositions === currentPositions) {
              nextPositions = { ...currentPositions };
            }

            nextPositions[change.id] = change.position;
          }

          if (change.type === "remove" && nextPositions[change.id]) {
            if (nextPositions === currentPositions) {
              nextPositions = { ...currentPositions };
            }

            delete nextPositions[change.id];
          }
        }

        return nextPositions;
      });
      return;
    }

    setManualNodePositions((currentPositions) => {
      let nextPositions = currentPositions;

      for (const change of changes) {
        if (change.type === "position" && change.position) {
          if (nextPositions === currentPositions) {
            nextPositions = { ...currentPositions };
          }

          nextPositions[change.id] = change.position;
        }

        if (change.type === "remove" && nextPositions[change.id]) {
          if (nextPositions === currentPositions) {
            nextPositions = { ...currentPositions };
          }

          delete nextPositions[change.id];
        }
      }

      return nextPositions;
    });
  }, [runtimeLayout, runtimeState.active]);
  const activeNodeId = focusedNodeId;
  const activeMode = runtimeState.active ? "runtime" : focusedNodeId ? "focus" : null;
  const relationshipBudget = useMemo(() => {
    if (!laidOut || !activeNodeId || runtimeState.active) {
      return null;
    }

    return budgetRelationships(
      laidOut.edges.filter((edge) => visibleById.has(edge.source) && visibleById.has(edge.target)),
      visibleById,
      activeNodeId,
      6
    );
  }, [activeMode, activeNodeId, laidOut, runtimeState.active, visibleById]);
  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();

    if (!relationshipBudget || !activeNodeId) {
      return ids;
    }

    ids.add(activeNodeId);
    for (const relation of relationshipBudget.visible) {
      ids.add(relation.edge.source);
      ids.add(relation.edge.target);
    }

    return ids;
  }, [activeNodeId, relationshipBudget]);

  const nodes = useMemo<AtlasFlowNode[]>(() => {
    if (!laidOut) {
      return [];
    }

    const baseNodes = displayedLayoutNodes.map((node) => {
      const data = node.data as AtlasNode;
      const isLineageAnchor = typeof data.lineageKind === "string";
      const matchesSearch = normalizedSearch.length > 0 && data.path.toLowerCase().includes(normalizedSearch);
      const temporalPressure = nodeTemporalPressure(data, activeTemporalState);
      const temporalLevel = temporalPressureLevel(temporalPressure);
      const isActive = activeNodeId === node.id;
      const isHovered = hoveredNodeId === node.id;
      const isNeighbor = !isActive && connectedNodeIds.has(node.id);
      const hasFocusContext = Boolean(activeNodeId) && connectedNodeIds.size > 1;
      const hasCriticalEvent = Boolean(focusedLandmark);
      const visualState = composeNodeVisualState({
        isHovered,
        isFocused: isActive && activeMode === "focus",
        isSearchMatch: matchesSearch,
        isRelationshipRelevant: isActive || isNeighbor,
        hasFocusContext,
        temporalPressureLevel: temporalLevel,
        temporalPressureScore: temporalPressure,
        hasTemporalState: Boolean(activeTemporalState),
        hasCriticalEvent,
        isCriticalEventAffected: hasCriticalEvent && temporalPressure > 0.2,
        hasStructuralGuidance: Boolean(activeTemporalState && data.significanceLevel && !temporalLevel),
        isLowSignalCompressed: data.type === "file" && data.metadata?.compressionLevel === "low-signal"
      });
      const runtimePhase =
        runtimeState.active && runtimeLayout
          ? runtimeLayout.activeNodeId === node.id
            ? "current"
            : runtimeLayout.revealedNodeIds.has(node.id)
              ? "residue"
              : runtimeLayout.participatingNodeIds.has(node.id)
                ? "participating"
                : "background"
          : null;
      const resolvedVisualState = runtimePhase ? runtimeVisualState(runtimePhase) : visualState;
      const shouldShowStubs = !runtimeState.active && focusedNodeId === node.id;
      const outgoingCount = shouldShowStubs ? relationshipBudget?.totalOutgoing ?? 0 : 0;
      const incomingCount = shouldShowStubs ? relationshipBudget?.totalIncoming ?? 0 : 0;
      const firstOutgoingEdgeId = shouldShowStubs
        ? relationshipBudget?.visible.find((relation) => relation.direction === "outgoing")?.edge.id
        : undefined;
      const firstIncomingEdgeId = shouldShowStubs
        ? relationshipBudget?.visible.find((relation) => relation.direction === "incoming")?.edge.id
        : undefined;
      const resolvedPosition =
        runtimeState.active && runtimeLayout?.revealedNodeIds.has(node.id)
          ? runtimeNodePositions[node.id] ?? runtimeLayout.positions.get(node.id) ?? node.position
          : manualNodePositions[node.id] ?? node.position;

      return {
        ...node,
        position: resolvedPosition,
        draggable: runtimeState.active ? Boolean(runtimeLayout?.revealedNodeIds.has(node.id)) : !isLineageAnchor,
        selectable: false,
        zIndex: resolvedVisualState.zIndex,
        style: visualStateStyle(resolvedVisualState),
        data: {
          ...data,
          historyBadge: historyBadgeFor(data, graph?.fileHistory),
          temporalPressure,
          visualState: resolvedVisualState,
          runtimeStep: runtimeState.active ? runtimeState.chain?.nodes.find((runtimeNode) => runtimeNode.id === node.id)?.runtimeStep : undefined,
          relationStub:
            shouldShowStubs && (outgoingCount > 0 || incomingCount > 0)
              ? {
                  incomingCount,
                  outgoingCount,
                  firstIncomingEdgeId,
                  firstOutgoingEdgeId,
                  onTraceStart: handleTraceStart,
                  onTraceEnd: handleTraceEnd
                }
              : undefined
        },
        className: resolvedVisualState.className
      };
    });

    if (!runtimeLayout || !runtimeState.active) {
      return baseNodes;
    }

    const runtimeExtraNodes = runtimeLayout.extraNodes.map((node) => {
      const data = node.data as AtlasNode;
      const phase = runtimeLayout.activeNodeId === node.id ? "current" : "residue";
      const visualState = runtimeVisualState(phase);
      const resolvedPosition = runtimeNodePositions[node.id] ?? node.position;

      return {
        ...node,
        position: resolvedPosition,
        draggable: true,
        zIndex: visualState.zIndex,
        style: visualStateStyle(visualState),
        data: {
          ...data,
          historyBadge: historyBadgeFor(data, graph?.fileHistory),
          visualState
        },
        className: `${visualState.className} runtime-node`
      };
    });

    return [...baseNodes, ...runtimeExtraNodes];
  }, [
    activeMode,
    activeNodeId,
    connectedNodeIds,
    handleTraceEnd,
    handleTraceStart,
    displayedLayoutNodes,
    laidOut,
    manualNodePositions,
    normalizedSearch,
    relationshipBudget,
    focusedNodeId,
    hoveredNodeId,
    activeTemporalState,
    focusedLandmark,
    graph?.fileHistory,
    runtimeLayout,
    runtimeNodePositions,
    runtimeState
  ]);

  const edges = useMemo(() => {
    if (!laidOut) {
      return [];
    }

    const baseEdges = laidOut.lineageEdges;
    if (runtimeState.active && runtimeLayout) {
      return [...baseEdges, ...runtimeLayout.edges];
    }

    if (!activeNodeId || !tracedEdgeId) {
      return baseEdges;
    }

    const tracedEdge = laidOut.edges.find((edge) => edge.id === tracedEdgeId);
    if (!tracedEdge || (tracedEdge.source !== activeNodeId && tracedEdge.target !== activeNodeId)) {
      return baseEdges;
    }

    const isOutgoing = tracedEdge.source === activeNodeId;
    return [
      ...baseEdges,
      {
        ...tracedEdge,
        animated: false,
        className: undefined,
        data: {
          ...tracedEdge.data,
          direction: isOutgoing ? "outgoing" : "incoming",
          laneOffset: 0,
          mode: "focus",
          exactTrace: true
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isOutgoing ? "#2dd4bf" : "#facc15"
        }
      }
    ];
  }, [activeNodeId, laidOut, runtimeLayout, runtimeState.active, tracedEdgeId]);

  function renderRelationTrace(edgeId: string): {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  } {
    return {
      onMouseEnter: () => setTracedEdgeId(edgeId),
      onMouseLeave: () => setTracedEdgeId(null)
    };
  }

  function relationDirectionForEdge(edgeId: string, nodeId: string): "incoming" | "outgoing" {
    const edge = laidOut?.edges.find((candidate) => candidate.id === edgeId);
    return edge?.source === nodeId ? "outgoing" : "incoming";
  }

  function edgeMarkerColor(edgeId: string, nodeId: string): string {
    return relationDirectionForEdge(edgeId, nodeId) === "outgoing" ? "#2dd4bf" : "#facc15";
  }

  const relationLens = useMemo(() => {
    if (!laidOut || !selectedNode) {
      return null;
    }

    const budget = budgetRelationships(laidOut.edges, visibleById, selectedNode.id, 6);
    const visibleOutgoing = budget.visible
      .filter((relation) => relation.direction === "outgoing")
      .map((relation) => ({
        id: relation.edge.id,
        label: relation.otherNode?.label ?? relation.edge.target,
        count: Number(relation.edge.data?.importCount ?? 1)
      }));
    const visibleIncoming = budget.visible
      .filter((relation) => relation.direction === "incoming")
      .map((relation) => ({
        id: relation.edge.id,
        label: relation.otherNode?.label ?? relation.edge.source,
        count: Number(relation.edge.data?.importCount ?? 1)
      }));
    return {
      visibleOutgoing,
      visibleIncoming,
      hiddenVisibleOutgoing: budget.hiddenOutgoing,
      hiddenVisibleIncoming: budget.hiddenIncoming
    };
  }, [laidOut, selectedNode, visibleById]);

  const importedByCount = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type !== "file") {
      return 0;
    }

    return graph.edges.filter((edge) => edge.target === selectedNode.id).length;
  }, [graph, selectedNode]);
  const selectedFileWeight = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return null;
    }

    return architecturalWeightFor(selectedNode, importedByCount);
  }, [importedByCount, selectedNode]);
  const selectedFileRoles = useMemo(() => {
    if (!selectedNode || selectedNode.type !== "file") {
      return [];
    }

    return operationalRolesFor(selectedNode, importedByCount);
  }, [importedByCount, selectedNode]);
  const selectedRegionSummary = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type === "file") {
      return null;
    }

    return regionalSummaryFor(selectedNode, graph);
  }, [graph, selectedNode]);
  const selectedRegionGravity = useMemo(() => {
    return selectedRegionSummary ? dominantGravityFor(selectedRegionSummary) : null;
  }, [selectedRegionSummary]);
  const runtimeOriginNode = runtimeState.originNodeId ? graphNodeById.get(runtimeState.originNodeId) ?? null : null;
  const runtimeCurrentNode = runtimeLayout?.activeNodeId ? graphNodeById.get(runtimeLayout.activeNodeId) ?? null : null;
  const runtimePreviousNode = runtimeLayout?.previousNodeId ? graphNodeById.get(runtimeLayout.previousNodeId) ?? null : null;
  const runtimeNextNode = runtimeLayout?.nextNodeId ? graphNodeById.get(runtimeLayout.nextNodeId) ?? null : null;
  const runtimeCandidateFiles = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type === "file") {
      return [];
    }

    const connectedFileIds = new Set<string>();

    for (const edge of graph.edges) {
      connectedFileIds.add(edge.source);
      connectedFileIds.add(edge.target);
    }

    return graph.nodes
      .filter((node) => node.type === "file" && ownsPath(selectedNode, node.path))
      .sort((a, b) => {
        const connectionDifference = Number(connectedFileIds.has(b.id)) - Number(connectedFileIds.has(a.id));

        if (connectionDifference !== 0) {
          return connectionDifference;
        }

        return Number(b.metadata?.importCount ?? 0) - Number(a.metadata?.importCount ?? 0) || a.path.localeCompare(b.path);
      });
  }, [graph, selectedNode]);
  const selectedRuntimeFile = selectedRuntimeFileId ? graphNodeById.get(selectedRuntimeFileId) ?? null : null;

  useEffect(() => {
    if (!selectedNode || selectedNode.type === "file") {
      setSelectedRuntimeFileId(null);
      return;
    }

    setSelectedRuntimeFileId((currentFileId) => {
      if (currentFileId && runtimeCandidateFiles.some((file) => file.id === currentFileId)) {
        return currentFileId;
      }

      return runtimeCandidateFiles[0]?.id ?? null;
    });
  }, [runtimeCandidateFiles, selectedNode]);

  const handleTimelineReset = useCallback(() => {
    setTemporalIndex(0);
    setFocusedLandmarkId(null);
  }, []);

  const handleTemporalScrub = useCallback(
    (nextIndex: number) => {
      const clamped = Math.min(Math.max(0, nextIndex), Math.max(0, temporalStates.length - 1));
      const snapped = snapToLandmark(clamped, temporalLandmarks, 1);

      setTemporalIndex(snapped);
      setFocusedLandmarkId(temporalLandmarks.find((landmark) => landmark.index === snapped)?.id ?? null);
    },
    [temporalLandmarks, temporalStates.length]
  );

  const handleLandmarkFocus = useCallback((landmarkId: string) => {
    const landmark = temporalLandmarks.find((item) => item.id === landmarkId);
    if (!landmark) {
      return;
    }

    setFocusedLandmarkId(landmark.id);
    setTemporalIndex(landmark.index);
  }, [temporalLandmarks]);

  const startRuntimeFromFile = useCallback((fileNodeId: string) => {
    if (!graph) {
      return;
    }

    const fileNode = graphNodeById.get(fileNodeId);

    if (!fileNode || fileNode.type !== "file") {
      return;
    }

    const chain = buildRuntimeChain(graph, fileNode.id);

    if (!chain) {
      return;
    }

    setFocusedNodeId(fileNode.id);
    setTracedEdgeId(null);
    setRuntimeNodePositions({});
    setRuntimeState({
      active: true,
      originNodeId: fileNode.id,
      currentStep: 0,
      chain
    });
    setRuntimePlaybackActive(chain.nodes.length > 1);
  }, [graph, graphNodeById]);

  const handleRuntimeStart = useCallback(() => {
    if (!selectedNode) {
      return;
    }

    if (selectedNode.type === "file") {
      startRuntimeFromFile(selectedNode.id);
      return;
    }

    if (selectedRuntimeFileId) {
      startRuntimeFromFile(selectedRuntimeFileId);
    }
  }, [selectedNode, selectedRuntimeFileId, startRuntimeFromFile]);

  const handleRuntimeExit = useCallback(() => {
    setRuntimeState(inactiveRuntimeState);
    setRuntimePlaybackActive(false);
    setRuntimeNodePositions({});
    setTracedEdgeId(null);
  }, []);

  const handleRuntimeScrub = useCallback((step: number) => {
    setRuntimePlaybackActive(false);
    setRuntimeState((current) => {
      if (!current.active || !current.chain) {
        return current;
      }

      return {
        ...current,
        currentStep: Math.min(Math.max(0, step), Math.max(0, current.chain.nodes.length - 1))
      };
    });
  }, []);

  const handleRuntimeReplay = useCallback(() => {
    setRuntimeState((current) => {
      if (!current.active || !current.chain) {
        return current;
      }

      return {
        ...current,
        currentStep: 0
      };
    });
    setRuntimePlaybackActive(true);
  }, []);

  const handleRuntimeTogglePlay = useCallback(() => {
    setRuntimePlaybackActive((isPlaying) => !isPlaying);
  }, []);

  const handleNodeClick: NodeMouseHandler<AtlasFlowNode> = (_event, node) => {
    if (isLineageNode(node)) {
      const data = node.data as AtlasNode;

      navigateToContext(data.id === "root" ? null : data.id);
      return;
    }

    if (!isStructuralNode(node)) {
      return;
    }

    setFocusedNodeId(node.id);
    setSelectedNode(node.data as AtlasNode);
  };

  const handleNodeDoubleClick: NodeMouseHandler<AtlasFlowNode> = (_event, node) => {
    if (isLineageNode(node)) {
      const data = node.data as AtlasNode;

      navigateToContext(data.id === "root" ? null : data.id);
      return;
    }

    if (!isStructuralNode(node)) {
      return;
    }

    const data = node.data as AtlasNode;

    if (canEnter(data)) {
      setCurrentContextId(data.id);
      return;
    }

    setFocusedNodeId(node.id);
    setSelectedNode(data);
  };

  const handleNodeMouseEnter: NodeMouseHandler<AtlasFlowNode> = (_event, node) => {
    setHoveredNodeId(node.id);
  };

  const handleNodeMouseLeave: NodeMouseHandler<AtlasFlowNode> = () => {
    setHoveredNodeId(null);
  };

  function navigateToContext(contextId: string | null): void {
    setCurrentContextId(contextId);
  }

  function goToPage(nextPageIndex: number): void {
    if (!laidOut) {
      return;
    }

    setFocusedNodeId(null);
    setTracedEdgeId(null);
    setSelectedNode(null);
    setPageIndex(Math.min(Math.max(0, nextPageIndex), laidOut.totalPages - 1));
  }

  if (!graph || !laidOut || !structuralState) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">Paste a GitHub repo URL to generate the architecture graph.</div>
        <div className="empty-state__body">The prototype clones the repo, reads folders/files/imports, and renders the result here.</div>
      </div>
    );
  }

  return (
    <div className="graph-shell">
      <div className="breadcrumb-bar" aria-label="Current graph context">
        {laidOut.breadcrumbPath.map((item, index) => (
          <span className="breadcrumb-bar__item" key={item.id ?? "root"}>
            {index > 0 ? <span className="breadcrumb-bar__separator">/</span> : null}
            <button
              type="button"
              className={index === laidOut.breadcrumbPath.length - 1 ? "breadcrumb-bar__button is-active" : "breadcrumb-bar__button"}
              onClick={() => navigateToContext(item.id)}
            >
              {item.label}
            </button>
          </span>
        ))}
      </div>

      <ReactFlow<AtlasFlowNode, AtlasFlowEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.24, duration: 420 }}
        minZoom={0.35}
        maxZoom={1.45}
        nodesDraggable={true}
        nodesConnectable={false}
        connectOnClick={false}
        nodeClickDistance={8}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        onInit={setReactFlowInstance}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onPaneClick={() => {
          if (runtimeState.active) {
            handleRuntimeExit();
            return;
          }

          setHoveredNodeId(null);
          setFocusedNodeId(null);
          setTracedEdgeId(null);
          setSelectedNode(null);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#263244" />
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          bgColor="#020617"
          nodeColor={(node) => {
            if (node.type === "domain") {
              return "#14b8a6";
            }

            if (typeof (node.data as AtlasNode).lineageKind === "string") {
              return "#64748b";
            }

            return node.type === "folder" ? "#38bdf8" : "#facc15";
          }}
          nodeStrokeColor="#e5eefb"
          nodeStrokeWidth={2}
          maskColor="rgba(2, 6, 23, 0.72)"
          maskStrokeColor="rgba(125, 211, 252, 0.55)"
          maskStrokeWidth={1}
        />
      </ReactFlow>

      {runtimeState.active && runtimeState.chain ? (
        <RuntimeScrubber
          chain={runtimeState.chain}
          currentStep={runtimeState.currentStep}
          isPlaying={runtimePlaybackActive}
          onScrub={handleRuntimeScrub}
          onReplay={handleRuntimeReplay}
          onTogglePlay={handleRuntimeTogglePlay}
        />
      ) : (
        <TemporalScrubber
          totalStates={temporalStates.length}
          currentIndex={temporalIndex}
          activeDate={activeTemporalDate}
          landmarks={temporalLandmarks}
          focusedLandmarkId={focusedLandmarkId}
          isCollapsed={timelineCollapsed}
          onScrub={handleTemporalScrub}
          onLandmarkFocus={handleLandmarkFocus}
          onReset={handleTimelineReset}
          onToggleCollapsed={() => setTimelineCollapsed((collapsed) => !collapsed)}
        />
      )}
      <RawHistoryInspector
        visible={!runtimeState.active && !timelineCollapsed && Boolean(focusedLandmark)}
        landmark={focusedLandmark}
        commits={commits}
      />

      <div className="context-panel">
        <div className="context-panel__label">Structural - Level {laidOut.level + 1}</div>
        <div className="context-panel__title">{laidOut.contextLabel}</div>
        <div className="context-panel__meta">
          {laidOut.visibleChildren} visible of {laidOut.totalChildren}
          {laidOut.hiddenChildren > 0 ? ` - page ${laidOut.currentPage + 1}/${laidOut.totalPages}` : ""}
        </div>
        {laidOut.totalPages > 1 ? (
          <div className="context-panel__pager" aria-label="Context page controls">
            <button type="button" onClick={() => goToPage(laidOut.currentPage - 1)} disabled={laidOut.currentPage === 0}>
              Prev
            </button>
            <button
              type="button"
              onClick={() => goToPage(laidOut.currentPage + 1)}
              disabled={laidOut.currentPage >= laidOut.totalPages - 1}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {currentContextId ? (
        <button type="button" className="overview-button" onClick={() => navigateToContext(null)}>
          Overview
        </button>
      ) : null}

      {runtimeState.active && runtimeState.chain ? (
        <RuntimeXRayOverlay
          chain={runtimeState.chain}
          originNode={runtimeOriginNode}
          currentNode={runtimeCurrentNode}
          previousNode={runtimePreviousNode}
          nextNode={runtimeNextNode}
          onExit={handleRuntimeExit}
        />
      ) : selectedNode ? (
        <aside className="metadata-panel operational-panel">
          <section className="operational-panel__identity" aria-label="Identity">
            <div className="metadata-panel__type">{panelObjectType(selectedNode)}</div>
            <div className="metadata-panel__title">{panelTitle(selectedNode)}</div>
            <div className="operational-panel__path">{orientationPath(selectedNode)}</div>
          </section>

          {selectedNode.type === "file" ? (
            <>
              <section className="operational-panel__region" aria-label="Architectural weight">
                <header className="operational-panel__header">
                  <h3>Architectural Weight</h3>
                  {selectedFileWeight ? (
                    <span className={`operational-panel__signal operational-panel__signal--${selectedFileWeight.toLowerCase()}`}>
                      {selectedFileWeight}
                    </span>
                  ) : null}
                </header>
                <div className="operational-panel__metrics">
                  {typeof selectedNode.metadata?.linesOfCode === "number" ? (
                    <div><strong>{selectedNode.metadata.linesOfCode}</strong><span>LOC</span></div>
                  ) : null}
                  {isJavaScriptEcosystemFile(selectedNode) && typeof selectedNode.metadata?.functionCount === "number" ? (
                    <div><strong>{selectedNode.metadata.functionCount}</strong><span>Functions</span></div>
                  ) : null}
                  <div><strong>{selectedNode.metadata?.importCount ?? 0}</strong><span>Imports</span></div>
                  <div><strong>{importedByCount}</strong><span>Imported by</span></div>
                </div>
              </section>

              <section className="operational-panel__region" aria-label="Operational role">
                <h3>Operational Role</h3>
                <ul className="operational-panel__roles">
                  {selectedFileRoles.map((role) => (
                    <li key={role.kind} className={`operational-panel__role--${role.kind}`}>
                      {role.label}
                    </li>
                  ))}
                </ul>
                {selectedNode.metadata?.compressionLevel === "low-signal" ? (
                  <p className="operational-panel__basis">Rule basis: {compressionDescription(selectedNode)}.</p>
                ) : null}
              </section>
            </>
          ) : selectedRegionSummary && selectedRegionGravity ? (
            <>
              <section className="operational-panel__region" aria-label="Regional density">
                <h3>Regional Density</h3>
                <div className="operational-panel__metrics">
                  <div><strong>{selectedRegionSummary.fileCount}</strong><span>Files</span></div>
                  <div><strong>{selectedRegionSummary.folderCount}</strong><span>Folders</span></div>
                  {typeof selectedRegionSummary.totalLinesOfCode === "number" ? (
                    <div><strong>{selectedRegionSummary.totalLinesOfCode}</strong><span>LOC</span></div>
                  ) : null}
                  {typeof selectedRegionSummary.totalFunctionCount === "number" ? (
                    <div><strong>{selectedRegionSummary.totalFunctionCount}</strong><span>Functions</span></div>
                  ) : null}
                </div>
                <p className="operational-panel__basis">{selectedRegionSummary.directChildCount} direct items in this territory.</p>
              </section>

              <section className="operational-panel__region" aria-label="Dominant gravity">
                <h3>Dominant Gravity</h3>
                <div className="operational-panel__gravity">{selectedRegionGravity.label}</div>
                {selectedRegionGravity.detail ? (
                  <p className="operational-panel__basis">{selectedRegionGravity.detail}</p>
                ) : null}
              </section>
            </>
          ) : null}

          <section
            className="operational-panel__region operational-panel__actions"
            aria-label={selectedNode.type === "file" ? "Activation surface" : "Regional actions"}
          >
            <h3>{selectedNode.type === "file" ? "Activation Surface" : "Regional Actions"}</h3>
            {selectedNode.type === "file" ? (
              <button type="button" className="metadata-panel__action metadata-panel__action--runtime" onClick={handleRuntimeStart}>
                Runtime X-Ray
              </button>
            ) : (
              <>
                {canEnter(selectedNode) ? (
                  <button type="button" className="metadata-panel__action" onClick={() => navigateToContext(selectedNode.id)}>
                    Enter Region
                  </button>
                ) : null}
                {runtimeCandidateFiles.length > 0 ? (
                  <div className="runtime-file-picker" aria-label="Runtime X-Ray file origin">
                    <label htmlFor="runtime-file-origin">Runtime origin</label>
                    <select
                      id="runtime-file-origin"
                      value={selectedRuntimeFileId ?? ""}
                      onChange={(event) => setSelectedRuntimeFileId(event.target.value || null)}
                    >
                      {runtimeCandidateFiles.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.path}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="metadata-panel__action metadata-panel__action--runtime"
                      onClick={handleRuntimeStart}
                      disabled={!selectedRuntimeFile}
                    >
                      Runtime X-Ray
                    </button>
                  </div>
                ) : null}
              </>
            )}
            {relationLens && (relationLens.visibleOutgoing.length > 0 || relationLens.visibleIncoming.length > 0) ? (
              <div className="operational-panel__traces" aria-label="Trace visible relationships">
                <div className="operational-panel__trace-title">Trace Visible Connections</div>
                {relationLens.visibleOutgoing.length > 0 ? (
                  <div>
                    <div className="operational-panel__trace-kind">Imports</div>
                    <ul>
                      {relationLens.visibleOutgoing.map((relation) => (
                        <li key={relation.id} {...renderRelationTrace(relation.id)}>
                          <span>{relation.label}</span>
                          <strong style={{ color: edgeMarkerColor(relation.id, selectedNode.id) }}>{relation.count}</strong>
                        </li>
                      ))}
                      {relationLens.hiddenVisibleOutgoing > 0 ? (
                        <li className="operational-panel__trace-more">+{relationLens.hiddenVisibleOutgoing} more visible imports</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
                {relationLens.visibleIncoming.length > 0 ? (
                  <div>
                    <div className="operational-panel__trace-kind">Imported By</div>
                    <ul>
                      {relationLens.visibleIncoming.map((relation) => (
                        <li key={relation.id} {...renderRelationTrace(relation.id)}>
                          <span>{relation.label}</span>
                          <strong style={{ color: edgeMarkerColor(relation.id, selectedNode.id) }}>{relation.count}</strong>
                        </li>
                      ))}
                      {relationLens.hiddenVisibleIncoming > 0 ? (
                        <li className="operational-panel__trace-more">+{relationLens.hiddenVisibleIncoming} more visible incoming</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </aside>
      ) : null}
    </div>
  );
}
