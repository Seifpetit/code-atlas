import type { AtlasNode } from "../api";
import type { RuntimeChain } from "./runtimeTypes";

interface RuntimeXRayOverlayProps {
  chain: RuntimeChain;
  originNode: AtlasNode | null;
  currentNode: AtlasNode | null;
  previousNode: AtlasNode | null;
  nextNode: AtlasNode | null;
  onExit: () => void;
}

function nodeLabel(node: AtlasNode | null): string {
  return node?.path ?? "None";
}

export function RuntimeXRayOverlay({
  chain,
  originNode,
  currentNode,
  previousNode,
  nextNode,
  onExit
}: RuntimeXRayOverlayProps) {
  return (
    <aside className="runtime-panel">
      <div className="runtime-panel__label">Runtime X-Ray Active</div>
      <div className="runtime-panel__title">{currentNode?.label ?? originNode?.label ?? "Runtime chain"}</div>
      <dl>
        <dt>Origin</dt>
        <dd>{nodeLabel(originNode)}</dd>
        <dt>Current Step</dt>
        <dd>{nodeLabel(currentNode)}</dd>
        <dt>Previous</dt>
        <dd>{nodeLabel(previousNode)}</dd>
        <dt>Next</dt>
        <dd>{nodeLabel(nextNode)}</dd>
        <dt>Chain Length</dt>
        <dd>{chain.nodes.length}</dd>
      </dl>
      <button type="button" className="runtime-panel__exit" onClick={onExit}>
        Exit X-Ray
      </button>
    </aside>
  );
}
