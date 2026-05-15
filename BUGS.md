# Known Bugs

## Hover preview flicker

The hover preview feature was removed because it flickered when moving across graph nodes.

Observed behavior:
- Hovering a node caused the preview panel and local highlight state to rapidly appear/disappear.
- The issue became worse after the preview panel was made non-interactive.

Likely cause:
- Hover-driven React state was competing with React Flow pointer events and node re-rendering.
- The graph updated class names and metadata panel state during hover, which could perturb hit testing and trigger repeated enter/leave events.

Needs fixing before reintroducing:
- Hover previews should not mount/unmount layout-affecting UI directly from raw enter/leave events.
- Hover state should be debounced or delayed.
- Preview UI should be rendered in a stable layer that cannot interfere with React Flow pointer events.
- Hover highlighting should be tested separately from metadata preview rendering.

## Hover Relationship Apparition Flicker

Status:
- Mitigated by fallback

Severity:
- Medium

Area:
- Structural graph hover interactions

Observed:
- Hovering a node causes relationship apparition lines to flicker briefly before stabilizing and showing correctly.
- The issue appears tied to hover event registration and render churn around relationship overlays.

Expected:
- Node hover should remain visually stable.
- If hover-driven relationship apparition is reintroduced later, hovering a node should immediately and stably show the temporary relationship apparition.
- The preview should disappear only when the pointer actually leaves the node/card.

Reproduction:
- Analyze a repository with visible import relationships.
- Hover a node that has direct visible relationships.
- Observe that relationship lines flicker briefly, then settle.

Debug attempt:
- Moved hover ownership from React Flow `onNodeMouseEnter` / `onNodeMouseLeave` handlers to card-level `onPointerEnter` / `onPointerLeave` handlers in the custom node component.
- Passed `onHoverStart` and `onHoverEnd` callbacks through node data.
- Set structural edges to `pointer-events: none`.
- Removed `transform: translateY(-1px)` from `.atlas-node:hover`.

Result:
- The behavior improved but did not fully resolve.
- Current result: flickers for a bit, then shows the relationship lines correctly.

Second debug attempt:
- Prevented hover from mounting relationship stubs inside the hovered node.
- Relationship stubs were changed to render only for the clicked/focused node.
- Hover still activated related nodes and soft fade behavior, but did not add/remove stub DOM inside the hovered card.

Second result:
- Failed.
- Hover was mostly deactivated visually, but still flickered at times.
- Decision after this attempt: fallback to CSS-only hover and move relationship apparition to click/focus only.

Fallback implemented:
- Removed React state updates from node hover.
- Node hover is now CSS-only.
- Relationship stubs appear only on clicked/focused nodes.
- Exact relationship traces appear only from focused stubs or relation-lens items.
- Default and hover states do not render relationship edges.

Notes:
- React Flow node/edge rerendering may still be invalidating hover state during apparition creation.
- Next likely fix: decouple hover detection from React Flow/node DOM churn by tracking pointer coordinates against stable node bounds, or add a short hover-enter/leave debounce with cancellation.

## Click Selection Sometimes Does Not Register

Status:
- Open

Severity:
- High

Area:
- Structural graph selection interactions

Observed:
- The interaction system does not feel smooth.
- Sometimes clicking a node does not register.
- The issue is especially noticeable when selecting a different node after another node is already focused.
- Focus switching can feel inconsistent or delayed.

Expected:
- Clicking any visible structural object should reliably focus it.
- Switching focus from one object to another should feel immediate and deterministic.
- Relationship stubs, hidden handles, pane interactions, and graph drag behavior should not interfere with basic selection.

Current suspected causes:
- Invisible React Flow handles are hidden with `opacity: 0` but may still receive pointer events.
- React Flow node dragging may classify small pointer movement as drag instead of click.
- `onPaneClick` may clear focus if a click target is interpreted as pane/background rather than node.
- Focusing a node changes rendered node data, relation stubs, classes, and faded states, which may perturb hit testing while switching selection.

Needs fixing:
- Make node selection the primary, reliable interaction.
- Disable or neutralize connection handles in structural read-only mode.
- Increase node click tolerance with `nodeClickDistance`.
- Re-evaluate whether structural nodes should be draggable at all.
- Ensure relation stubs do not steal normal node-selection clicks except when explicitly tracing relationships.
