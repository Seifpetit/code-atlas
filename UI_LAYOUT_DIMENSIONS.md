# UI Layout Dimensions

This file records important fixed UI dimensions and panel positions so spatial layout decisions stay explicit.

## Graph Shell Overlays

**Breadcrumb Bar**
- Position: top left
- `top: 14px`
- `left: 16px`
- Max width: `min(720px, calc(100vw - 360px))`

**Timeline Panel**
- Position: under breadcrumb/path panel
- `top: 62px`
- `left: 16px`
- Width: `min(320px, calc(100vw - 32px))`
- Max height: `334px`
- Timeline list max height: `270px`

**Structural Context Panel**
- Position: upper right
- `top: 366px`
- `right: 16px`

**Path Anchor Nodes**
- Render inside React Flow as non-interactive lineage nodes.
- Width: `178px`
- Height: `72px`
- Horizontal gap: `34px`
- Top position: `y: 0`
- Current-layer child offset during descent: `150px` y.
- The latest path anchor links to each current child.

**MiniMap**
- React Flow panel position: `bottom-right`
- Background: dark Atlas chrome
- Node colors:
  - Domain: teal
  - Folder: sky
  - File: purple

**Controls**
- React Flow panel position: `bottom-left`
- Button size: `38px`

## Responsive Rules

At `max-width: 900px`:
- Timeline moves to bottom dock.
- Timeline max height becomes `190px`.
- Timeline list becomes horizontal.

At `max-width: 760px`:
- Breadcrumb stretches from `left: 16px` to `right: 16px`.
- Structural context panel uses `top: 330px`.

## Layout Rule

Do not add or move graph overlay panels without updating this file.
