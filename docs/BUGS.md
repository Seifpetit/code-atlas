# Known Bugs

## Highlighting Felt Random Because Signals Competed

Status:
- Fixed

Severity:
- Medium

Area:
- Graph node highlighting, attention states

Observed:
- The same object could appear highlighted in different ways depending on whether search, focus, temporal pressure, significance, or fade state was active.
- CSS source order and additive classes could make weaker signals visually override stronger product intent.

Expected:
- Every glow or emphasis should have a clear reason.
- Only one dominant attention state should exist per node at a time.
- Interaction focus should not visually compete with temporal or structural background signals.

Cause:
- Highlighting was assembled directly in `GraphView` and `nodeTypes` through independent classes such as focus, temporal, muted, search, and significance.
- There was no central signal arbitration model.

Fix:
- Added a central attention compositor under `frontend/src/graph/attention/`.
- `GraphView` now provides attention signals and receives one final `NodeVisualState`.
- Historical significance no longer independently adds node highlight classes.
- CSS now styles attention layers instead of scattered feature-owned highlight classes.

Needs watching:
- New features that affect attention must route through the attention compositor instead of adding direct node classes.

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

Current state:
- Lightweight hover attention has been reintroduced through the central attention compositor.
- Hover previews and hover-driven relationship apparition remain disabled.
- If flicker returns, first inspect whether hover state is causing node layout, relation stubs, or edge overlays to mount/unmount.

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

## Third-Party React Flow UI Defaults Override Atlas Styling

Status:
- Fixed / watch for recurrence

Severity:
- Low

Area:
- React Flow controls, minimap, and built-in UI styling

Observed:
- The bottom-left zoom controls appeared as a white rectangle that looked like a screen glitch.
- Editing `.react-flow__controls` and `.react-flow__controls-button` initially appeared to do nothing.
- The minimap also appeared mostly white and did not visually communicate the current structural objects clearly.

Expected:
- Built-in React Flow UI should visually match Code Atlas chrome.
- Zoom controls should show clear `+`, `-`, and fit/center symbols with strong contrast.
- The minimap should use a dark background and visible node colors for domains, folders, and files.

Cause:
- `@xyflow/react/dist/style.css` was imported after `frontend/src/styles.css`, so React Flow defaults overrode local Atlas styles.
- React Flow minimap defaults use a white background unless overridden by props or CSS variables/classes.

Fix:
- Import `@xyflow/react/dist/style.css` before `frontend/src/styles.css` in `frontend/src/main.tsx`.
- Add explicit dark styling for `.react-flow__controls`, `.react-flow__controls-button`, `.react-flow__minimap`, `.react-flow__minimap-svg`, and `.react-flow__minimap-node`.
- Pass explicit MiniMap props: `bgColor`, `nodeColor`, `nodeStrokeColor`, `nodeStrokeWidth`, `maskColor`, `maskStrokeColor`, and `maskStrokeWidth`.

Needs watching:
- Any new React Flow built-in component should be checked against Atlas styling after import order changes.
- If a style override does nothing, first verify CSS load order and whether the component is driven by React Flow CSS variables or props.

## React Flow MiniMap Did Not Render Structural Objects

Status:
- Fixed

Severity:
- Medium

Area:
- React Flow minimap, structural layout metadata

Observed:
- The minimap background rendered after styling fixes, but structural objects did not appear inside it.
- The minimap looked empty even though graph nodes were visible on the main canvas.

Expected:
- The minimap should show the current visible structural context.
- Domains, folders, and files should appear as small colored rectangles matching their structural object type.

Cause:
- React Flow MiniMap only renders nodes that have measurable dimensions.
- Code Atlas custom nodes were visually sized through CSS variables from `data.layoutWidth` and `data.layoutHeight`.
- The React Flow node objects themselves did not include `width`, `height`, `initialWidth`, or `initialHeight`, so MiniMap skipped them.

Fix:
- Add `width`, `height`, `initialWidth`, and `initialHeight` to each generated React Flow node in `frontend/src/graph/layout.ts`.
- Keep the existing `layoutWidth` and `layoutHeight` data fields for custom node CSS sizing.

Needs watching:
- Any future custom node sizing system must update both the visual node CSS data and the React Flow node dimensions.
- If MiniMap appears empty while canvas nodes are visible, first check node dimensions on the React Flow node objects.

## File Metrics Displayed False Zero Values For Missing Payload Data

Status:
- Fixed

Severity:
- Medium

Area:
- File node metadata and focused details panel

Observed:
- File nodes displayed `0L` and `0F` when the current analysis payload did not
  contain the newly introduced metric fields.
- Non-JS/TS structural files also displayed a function count even though
  function analysis does not apply to them.

Expected:
- Metrics should appear only when supplied by the backend analysis.
- LOC applies to all displayed files; function count appears only for
  JS/TS-family files.

Fix:
- The UI no longer treats missing metric fields as zero.
- The backend omits `functionCount` for non-JS/TS files.
- Function metadata rendering is gated to JS/TS-family extensions.
