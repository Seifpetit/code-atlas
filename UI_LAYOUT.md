# UI Layout

This file records fixed UI dimensions, panel positions, and color roles so spatial and visual decisions stay explicit.

## Color Theme

**Core Surface**
- App background: `#070b12`
- Topbar background: `#0b111c`
- Toolbar background: `#090f19`
- Panel background: `rgba(15, 23, 42, 0.92-0.97)`
- Primary text: `#e5eefb`
- Muted text: `#94a3b8`

**Structural Node Colors**
- Domain: teal
  - Border: `#14b8a6`
  - Body: `#0b282d`
- Folder: cyan / sky
  - Border: `#38bdf8`
  - Body: `#0c2230`
- File: amber yellow
  - Border: `#facc15`
  - Body: `#2a230d`
  - Fold accent: amber-tinted

**Interaction Colors**
- Primary action: `#2dd4bf`
- Outgoing dependency: `#2dd4bf`
- Incoming dependency: `#facc15`
- Runtime active edge: `#f8fafc`
- Runtime causal residue: `rgba(45, 212, 191, 0.72)`
- Runtime structural residue: `rgba(125, 211, 252, 0.42)`

**MiniMap Colors**
- Domain: teal
- Folder: sky
- File: amber yellow
- Lineage anchor: slate

## Dimensions

### Graph Shell Overlays

**Breadcrumb Bar**
- Position: top left
- `top: 14px`
- `left: 16px`
- Max width: `min(720px, calc(100vw - 360px))`

**Timeline Panel**
- Position: under breadcrumb/path panel
- `top: 56px`
- `left: 16px`
- Width: `min(320px, calc(100vw - 32px))`
- Min height: `216px`
- Max height: `268px`
- Contains the `TemporalScrubber` custom range control.
- Commit-list timeline dimensions are deprecated.

**Structural Context Panel**
- Position: upper right
- `top: 318px`
- `right: 16px`

**Raw History Inspector**
- Position: below the temporal scrubber
- `top: 342px`
- `left: 16px`
- Width: `min(320px, calc(100vw - 32px))`
- Max height: `260px`

**Path Anchor Nodes**
- Render inside React Flow as non-interactive lineage nodes.
- Width: `178px`
- Height: `72px`
- Horizontal gap: `34px`
- Top position: `y: 0`
- Current-layer child offset during descent: `150px` y.
- The latest path anchor links to each current child.

### Graph Node Dimensions

These values are layout inputs, not decorative CSS-only values. React Flow node bounds, collision checks, runtime placement, and the visible node chrome should stay aligned with them.

**Domain Nodes**
- Source: `frontend/src/graph/layout.ts`
- Width: `286px`
- Height: `138px`
- Used for root-level folder nodes rendered as domains.

**Folder Nodes**
- Source: `frontend/src/graph/layout.ts`
- Width: `246px`
- Height: `108px`
- Visible chrome uses the folder shape with a tab.

**File Nodes**
- Source: `frontend/src/graph/layout.ts`
- Width: `130px`
- Height: `180px`
- Files are intentionally vertical rectangles.
- Visible chrome uses the file shape with a folded corner.

**Runtime Artifacts**
- Source: `frontend/src/runtime/runtimeLayout.ts`
- Width: `130px`
- Height: `180px`
- Runtime Artifacts should match normal file-node proportions unless a deliberate runtime-specific decision is recorded here.
- Runtime Artifact collision detection is artifact-to-artifact only; background structural nodes are not obstacles.

**Fallback Rect Bounds**
- Source: `frontend/src/graph/overlap.ts`
- Width: `210px`
- Height: `92px`
- Used only when a node has no explicit `layoutWidth` / `layoutHeight`.

**MiniMap**
- React Flow panel position: `bottom-right`
- Background: dark Atlas chrome

**Controls**
- React Flow panel position: `bottom-left`
- Button size: `38px`

### Responsive Rules

At `max-width: 900px`:
- Timeline moves to bottom dock.
- Timeline min height becomes `140px`.
- Timeline max height becomes `160px`.
- Raw history inspector moves above the timeline at `bottom: 184px`.

At `max-width: 760px`:
- Breadcrumb stretches from `left: 16px` to `right: 16px`.
- Structural context panel uses `top: 292px`.

## Layout Rule

Do not add or move graph overlay panels, change node dimensions, or change structural colors without updating this file.
