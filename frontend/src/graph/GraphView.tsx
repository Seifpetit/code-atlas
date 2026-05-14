import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeMouseHandler,
  type ReactFlowInstance
} from "@xyflow/react";
import type { AtlasGraph, AtlasNode } from "../api";
import type { ClusteringMode } from "./clustering";
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
  pageIndex: number;
  breadcrumbPath: string[];
  clusteringMode: ClusteringMode;
}

function isStructuralNode(node: AtlasFlowNode): node is AtlasFlowNode {
  return node.type === "domain" || node.type === "folder" || node.type === "file";
}

function canEnter(node: AtlasNode): boolean {
  return node.type === "folder" && Number(node.metadata?.childCount ?? 0) > 0;
}

export function GraphView({ graph, searchTerm, clusteringMode }: GraphViewProps) {
  const [selectedNode, setSelectedNode] = useState<AtlasNode | null>(null);
  const [currentContextId, setCurrentContextId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<AtlasFlowNode, AtlasFlowEdge> | null>(null);
  const laidOut = useMemo(
    () => (graph ? layoutStructuralContext(graph, currentContextId, pageIndex) : null),
    [currentContextId, graph, pageIndex]
  );
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const structuralState = useMemo<StructuralState | null>(() => {
    if (!laidOut) {
      return null;
    }

    return {
      currentContextId,
      focusedNodeId,
      pageIndex: laidOut.currentPage,
      breadcrumbPath: laidOut.breadcrumbPath.map((item) => item.id ?? "root"),
      clusteringMode
    };
  }, [clusteringMode, currentContextId, focusedNodeId, laidOut]);

  useEffect(() => {
    setCurrentContextId(null);
    setFocusedNodeId(null);
    setSelectedNode(null);
    setPageIndex(0);
  }, [graph]);

  useEffect(() => {
    setFocusedNodeId(null);
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
  }, [laidOut, reactFlowInstance]);

  const activeNodeId = focusedNodeId;
  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();

    if (!laidOut || !activeNodeId) {
      return ids;
    }

    ids.add(activeNodeId);
    for (const edge of laidOut.edges) {
      if (edge.source === activeNodeId) {
        ids.add(edge.target);
      }

      if (edge.target === activeNodeId) {
        ids.add(edge.source);
      }
    }

    return ids;
  }, [activeNodeId, laidOut]);

  const nodes = useMemo<AtlasFlowNode[]>(() => {
    if (!laidOut) {
      return [];
    }

    return laidOut.nodes.map((node) => {
      const data = node.data as AtlasNode;
      const matchesSearch = normalizedSearch.length > 0 && data.path.toLowerCase().includes(normalizedSearch);
      const isActive = activeNodeId === node.id;
      const isNeighbor = !isActive && connectedNodeIds.has(node.id);
      const shouldFade = Boolean(activeNodeId) && !connectedNodeIds.has(node.id);
      const className = [
        matchesSearch ? "is-search-match" : "",
        isActive ? "is-focused-node" : "",
        isNeighbor ? "is-neighbor-node" : "",
        shouldFade ? "is-faded-node" : ""
      ]
        .filter(Boolean)
        .join(" ");

      return {
        ...node,
        className: className || undefined
      };
    });
  }, [activeNodeId, connectedNodeIds, laidOut, normalizedSearch]);

  const edges = useMemo(() => {
    if (!laidOut) {
      return [];
    }

    if (!activeNodeId) {
      return laidOut.edges;
    }

    return laidOut.edges.map((edge) => {
      const isRelated = edge.source === activeNodeId || edge.target === activeNodeId;

      return {
        ...edge,
        animated: isRelated && Boolean(focusedNodeId),
        className: isRelated ? "is-related-edge" : "is-muted-edge"
      };
    });
  }, [activeNodeId, focusedNodeId, laidOut]);

  const importedByCount = useMemo(() => {
    if (!graph || !selectedNode || selectedNode.type !== "file") {
      return 0;
    }

    return graph.edges.filter((edge) => edge.target === selectedNode.id).length;
  }, [graph, selectedNode]);

  const handleNodeClick: NodeMouseHandler<AtlasFlowNode> = (_event, node) => {
    if (!isStructuralNode(node)) {
      return;
    }

    setFocusedNodeId(node.id);
    setSelectedNode(node.data as AtlasNode);
  };

  const handleNodeDoubleClick: NodeMouseHandler<AtlasFlowNode> = (_event, node) => {
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
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.24, duration: 420 }}
        minZoom={0.35}
        maxZoom={1.45}
        nodesDraggable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        onInit={setReactFlowInstance}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={() => {
          setFocusedNodeId(null);
          setSelectedNode(null);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#263244" />
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => {
            if (node.type === "domain") {
              return "#14b8a6";
            }

            return node.type === "folder" ? "#38bdf8" : "#8b5cf6";
          }}
          maskColor="rgba(2, 6, 23, 0.72)"
        />
      </ReactFlow>

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
        </aside>
      ) : null}
    </div>
  );
}
