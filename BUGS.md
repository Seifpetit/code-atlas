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
