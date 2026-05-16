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
import {
  formatCommitDate,
  historyBadgeFor
} from "../history/historyUtils";
import { extractArchitecturalLandmarks, snapToLandmark } from "../time/landmarkExtraction";
import { RawHistoryInspector } from "../time/RawHistoryInspector";
import { TemporalScrubber } from "../time/TemporalScrubber";
import { buildTemporalStates, nodeTemporalPressure, temporalPressureLevel } from "../time/temporalPressure";
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

function contextOwnsPath(contextId: string | null, path: string): boolean {
  if (!contextId) {
    return true;
  }

  return path === contextId || path.startsWith(`${contextId}/`);
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
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [tracedEdgeId, setTracedEdgeId] = useState<string | null>(null);
  const [temporalIndex, setTemporalIndex] = useState(0);
  const [focusedLandmarkId, setFocusedLandmarkId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [manualNodePositions, setManualNodePositions] = useState<ManualNodePositions>({});
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<AtlasFlowNode, AtlasFlowEdge> | null>(null);
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
    setFocusedNodeId(null);
    setTracedEdgeId(null);
    setTemporalIndex(0);
    setFocusedLandmarkId(null);
    setSelectedNode(null);
    setPageIndex(0);
    setManualNodePositions({});
  }, [graph]);

  useEffect(() => {
    setFocusedNodeId(null);
    setTracedEdgeId(null);
    setSelectedNode(null);
    setPageIndex(0);
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
  }, [laidOut, reactFlowInstance, temporalIndex]);

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
  const handleNodesChange = useCallback((changes: NodeChange<AtlasFlowNode>[]) => {
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
  }, []);
  const activeNodeId = focusedNodeId;
  const activeMode = focusedNodeId ? "focus" : null;
  const relationshipBudget = useMemo(() => {
    if (!laidOut || !activeNodeId) {
      return null;
    }

    return budgetRelationships(
      laidOut.edges.filter((edge) => visibleById.has(edge.source) && visibleById.has(edge.target)),
      visibleById,
      activeNodeId,
      6
    );
  }, [activeMode, activeNodeId, laidOut, visibleById]);
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

    return displayedLayoutNodes.map((node) => {
      const data = node.data as AtlasNode;
      const isLineageAnchor = typeof data.lineageKind === "string";
      const matchesSearch = normalizedSearch.length > 0 && data.path.toLowerCase().includes(normalizedSearch);
      const temporalPressure = nodeTemporalPressure(data, activeTemporalState);
      const temporalLevel = temporalPressureLevel(temporalPressure);
      const isActive = activeNodeId === node.id;
      const isNeighbor = !isActive && connectedNodeIds.has(node.id);
      const shouldFade = Boolean(activeNodeId) && connectedNodeIds.size > 1 && !connectedNodeIds.has(node.id);
      const temporalMuted = Boolean(activeTemporalState) && temporalPressure <= 0.2;
      const shouldShowStubs = focusedNodeId === node.id;
      const outgoingCount = shouldShowStubs ? relationshipBudget?.totalOutgoing ?? 0 : 0;
      const incomingCount = shouldShowStubs ? relationshipBudget?.totalIncoming ?? 0 : 0;
      const firstOutgoingEdgeId = shouldShowStubs
        ? relationshipBudget?.visible.find((relation) => relation.direction === "outgoing")?.edge.id
        : undefined;
      const firstIncomingEdgeId = shouldShowStubs
        ? relationshipBudget?.visible.find((relation) => relation.direction === "incoming")?.edge.id
        : undefined;
      const className = [
        matchesSearch ? "is-search-match" : "",
        isActive && activeMode === "focus" ? "is-focused-node" : "",
        isNeighbor ? "is-neighbor-node" : "",
        shouldFade && activeMode === "focus" ? "is-faded-node" : "",
        temporalLevel ? `is-temporal-${temporalLevel}-node` : "",
        temporalMuted ? "is-history-muted-node" : ""
      ]
        .filter(Boolean)
        .join(" ");

      return {
        ...node,
        position: manualNodePositions[node.id] ?? node.position,
        draggable: !isLineageAnchor,
        selectable: false,
        data: {
          ...data,
          historyBadge: historyBadgeFor(data, graph?.fileHistory),
          temporalPressure,
          significanceLevel: temporalLevel ?? data.significanceLevel,
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
        className: className || undefined
      };
    });
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
    activeTemporalState,
    graph?.fileHistory
  ]);

  const edges = useMemo(() => {
    if (!laidOut) {
      return [];
    }

    const baseEdges = laidOut.lineageEdges;
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
  }, [activeNodeId, laidOut, tracedEdgeId]);

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
    if (!graph || !laidOut || !selectedNode) {
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
    const allVisibleOutgoing = laidOut.edges
      .filter((edge) => edge.source === selectedNode.id)
      .map((edge) => ({
        id: edge.id,
        label: visibleById.get(edge.target)?.label ?? edge.target,
        count: Number(edge.data?.importCount ?? 1)
      }));
    const allVisibleIncoming = laidOut.edges
      .filter((edge) => edge.target === selectedNode.id)
      .map((edge) => ({
        id: edge.id,
        label: visibleById.get(edge.source)?.label ?? edge.source,
        count: Number(edge.data?.importCount ?? 1)
      }));
    let internalOutgoing = 0;
    let internalIncoming = 0;
    let externalOutgoing = 0;
    let externalIncoming = 0;

    for (const edge of graph.edges) {
      const sourceOwned = ownsPath(selectedNode, edge.source);
      const targetOwned = ownsPath(selectedNode, edge.target);

      if (sourceOwned && !targetOwned) {
        if (contextOwnsPath(currentContextId, edge.target)) {
          internalOutgoing += 1;
        } else {
          externalOutgoing += 1;
        }
      }

      if (!sourceOwned && targetOwned) {
        if (contextOwnsPath(currentContextId, edge.source)) {
          internalIncoming += 1;
        } else {
          externalIncoming += 1;
        }
      }
    }

    return {
      visibleOutgoing,
      visibleIncoming,
      allVisibleOutgoing,
      allVisibleIncoming,
      hiddenVisibleOutgoing: budget.hiddenOutgoing,
      hiddenVisibleIncoming: budget.hiddenIncoming,
      internalOutgoing,
      internalIncoming,
      externalOutgoing,
      externalIncoming
    };
  }, [currentContextId, graph, laidOut, selectedNode, visibleById]);

  const importedByCount = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type !== "file") {
      return 0;
    }

    return graph.edges.filter((edge) => edge.target === selectedNode.id).length;
  }, [graph, selectedNode]);
  const selectedFileHistory = selectedNode?.type === "file" ? graph?.fileHistory?.[selectedNode.path] : undefined;

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
        onPaneClick={() => {
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

            return node.type === "folder" ? "#38bdf8" : "#8b5cf6";
          }}
          nodeStrokeColor="#e5eefb"
          nodeStrokeWidth={2}
          maskColor="rgba(2, 6, 23, 0.72)"
          maskStrokeColor="rgba(125, 211, 252, 0.55)"
          maskStrokeWidth={1}
        />
      </ReactFlow>

      <TemporalScrubber
        totalStates={temporalStates.length}
        currentIndex={temporalIndex}
        activeDate={activeTemporalDate}
        landmarks={temporalLandmarks}
        focusedLandmarkId={focusedLandmarkId}
        onScrub={handleTemporalScrub}
        onLandmarkFocus={handleLandmarkFocus}
        onReset={handleTimelineReset}
      />
      <RawHistoryInspector visible={Boolean(focusedLandmark)} landmark={focusedLandmark} commits={commits} />

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

      {selectedNode ? (
        <aside className="metadata-panel">
          <div className="metadata-panel__type">{selectedNode.type}</div>
          <div className="metadata-panel__title">{selectedNode.label}</div>
          <dl>
            <dt>Path</dt>
            <dd>{selectedNode.path}</dd>
            <dt>Parent</dt>
            <dd>{selectedNode.parent ?? "Repository root"}</dd>
            {selectedNode.type === "file" ? (
              <>
                <dt>Imports</dt>
                <dd>{selectedNode.metadata?.importCount ?? 0}</dd>
                <dt>Imported by</dt>
                <dd>{importedByCount}</dd>
                <dt>Commits</dt>
                <dd>{selectedFileHistory?.commitCount ?? 0}</dd>
                <dt>Last modified</dt>
                <dd>{selectedFileHistory ? formatCommitDate(selectedFileHistory.lastModified) : "Unknown"}</dd>
                <dt>Authors</dt>
                <dd>{selectedFileHistory?.authors.slice(0, 3).join(", ") || "Unknown"}</dd>
              </>
            ) : (
              <>
                <dt>Children</dt>
                <dd>{selectedNode.metadata?.childCount ?? 0}</dd>
              </>
            )}
          </dl>
          {selectedNode && canEnter(selectedNode) ? (
            <button type="button" className="metadata-panel__action" onClick={() => navigateToContext(selectedNode.id)}>
              Enter
            </button>
          ) : null}
          {relationLens ? (
            <section className="relation-lens" aria-label="Focused relation lens">
              <div className="relation-lens__title">Relations</div>
              <div className="relation-lens__stats">
                <div>
                  <span>Imports</span>
                  <strong>{relationLens.internalOutgoing + relationLens.externalOutgoing}</strong>
                </div>
                <div>
                  <span>Imported by</span>
                  <strong>{relationLens.internalIncoming + relationLens.externalIncoming}</strong>
                </div>
                <div>
                  <span>Outside</span>
                  <strong>{relationLens.externalOutgoing + relationLens.externalIncoming}</strong>
                </div>
              </div>
              <div className="relation-lens__columns">
                <div>
                  <div className="relation-lens__subtitle">Visible imports</div>
                  {relationLens.visibleOutgoing.length > 0 ? (
                    <ul>
                      {relationLens.visibleOutgoing.map((relation) => (
                        <li key={relation.id} {...renderRelationTrace(relation.id)}>
                          <span>{relation.label}</span>
                          <strong style={{ color: edgeMarkerColor(relation.id, selectedNode.id) }}>{relation.count}</strong>
                        </li>
                      ))}
                      {relationLens.hiddenVisibleOutgoing > 0 ? (
                        <li className="relation-lens__more">+{relationLens.hiddenVisibleOutgoing} more visible imports</li>
                      ) : null}
                    </ul>
                  ) : (
                    <p>No visible outgoing imports.</p>
                  )}
                </div>
                <div>
                  <div className="relation-lens__subtitle">Visible imported by</div>
                  {relationLens.visibleIncoming.length > 0 ? (
                    <ul>
                      {relationLens.visibleIncoming.map((relation) => (
                        <li key={relation.id} {...renderRelationTrace(relation.id)}>
                          <span>{relation.label}</span>
                          <strong style={{ color: edgeMarkerColor(relation.id, selectedNode.id) }}>{relation.count}</strong>
                        </li>
                      ))}
                      {relationLens.hiddenVisibleIncoming > 0 ? (
                        <li className="relation-lens__more">+{relationLens.hiddenVisibleIncoming} more visible incoming</li>
                      ) : null}
                    </ul>
                  ) : (
                    <p>No visible incoming imports.</p>
                  )}
                </div>
              </div>
            </section>
          ) : null}
          {selectedFileHistory?.recentCommits.length ? (
            <section className="file-history" aria-label="Selected file history">
              <div className="file-history__title">Recent history</div>
              <ul>
                {selectedFileHistory.recentCommits.map((commit) => (
                  <li key={commit.hash}>
                    <span>{commit.message}</span>
                    <strong>{commit.shortHash}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
