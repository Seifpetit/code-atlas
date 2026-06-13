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
- Folder: cyan / sky
  - Border: `#38bdf8`
  - Body: `#0c2230`
- File: neutral `#333` body with extension-classified border and fold accent
  - JS/TS (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`): amber `#facc15`
  - Python (`.py`): blue `#60a5fa`
  - Markdown (`.md`) / MDX (`.mdx`): violet / purple
  - JSON / TOML: orange / amber
  - YAML (`.yml`, `.yaml`): pink
  - CSS / SCSS / Sass / Less: sky / pink / rose / indigo
  - HTML / SVG / XML: rose / emerald / cyan
  - Text / PowerShell / shell: slate / blue / lime
  - Unknown or extensionless: amber fallback
- File border color is a deterministic format cue only; attention, temporal, and
  runtime states may override chrome emphasis.
- File format outlines use an `80%` opacity `3px` vector stroke following the
  rounded body and cut folded edge; the folded surface is an interior accent.

**Interaction Colors**
- Primary action: `#2dd4bf`
- Outgoing dependency: `#2dd4bf`
- Incoming dependency: `#facc15`
- Runtime active edge: `#f8fafc`
- Runtime causal residue: `rgba(45, 212, 191, 0.72)`
- Runtime structural residue: `rgba(125, 211, 252, 0.42)`

**Connection Lines**
- Every contextual, lineage, and runtime connection is rendered beneath node
  objects in the graph layering order.
- Visible connections use thin moving cut-line segments; brighter movement
  indicates active focus or runtime causality without becoming a foreground
  overlay.
- Motion is disabled for reduced-motion preferences.

**Operational Role Accents**
- Rule-classified low-signal: slate.
- Configuration: amber.
- Structural support: sky.
- Index or export gateway: violet.
- Dependency hub candidate: rose.
- Runtime-related candidate: teal.
- Rendering or projection candidate: blue.
- Leaf dependency candidate: lime.
- Unconnected implementation: muted slate.
- Connected implementation: cyan.
- Accents identify deterministic role categories only; they do not express
  confidence or severity.

**Refactor Pressure Colors**
- Risk X-Ray Start Here: green border `#22c55e` with restrained emerald glow.
- Risk X-Ray Foundation: blue border `#3b82f6` with restrained blue glow.
- Risk X-Ray Needs Isolation: gold border `#eab308` with restrained warm glow.
- Risk X-Ray High-Leverage Risk: magenta border `#d946ef` with restrained
  magenta glow.
- Risk X-Ray Critical Surface: red border `#ef4444` with restrained red glow.
- Risk X-Ray Stable: slate border `#64748b` with minimal slate glow.
- These colors override only file outline, folded-corner chrome, and a soft
  behind-node glow while Risk X-Ray is active.

**MiniMap Colors**
- Folder: sky
- File: solid representative accent from its extension palette
- Lineage anchor: slate

## Dimensions

### Graph Shell Overlays

**Workflow Toolbar**
- The toolbar overlays the graph shell at the top after a graph is loaded.
- The textual status message and status dot are not rendered in the toolbar.
- The function inventory control starts collapsed as a compact `Functions`
  chip with an icon and raw count, then unfolds inline to show raw/runtime/ghost
  counts plus a compact inventory-open icon.
- Saved-map controls start collapsed behind a permanent gold `Save/Load` button with a save
  icon; activating it expands the existing save name, save, load, open, and
  share controls inline.

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
- Expanded dimensions remain unchanged when collapse is available.
- Collapsed state renders a timeline-icon trigger at the same origin.
- Collapsed trigger width and height: `40px`.
- Commit-list timeline dimensions are deprecated.

**Structural Context Panel**
- Position: upper right
- `top: 318px`
- `right: 16px`

**Structural Selection Tool**
- Position: floats over the upper-right canvas, aligned to the breadcrumb panel's vertical origin.
- Placement: `top: 14px`, `right: 16px`.
- Tool chrome padding: `0px`.
- The green `Risk` tool sits directly to the left of `Select` in the same
  overlay row.
- Activating `Risk` shows a fast left-to-right scanline over the graph shell
  and switches file chrome to the refactor pressure palette.
- While active, Risk X-Ray shows a compact top-right dot legend mapping each
  category color to `Start Here`, `Foundation`, `Needs Isolation`,
  `High-Leverage Risk`, `Critical Surface`, and `Stable`.
- When active, dragging on the graph surface draws a subdued cyan dashed
  selection zone using partial node intersection.
- Dragging a selection zone into a canvas edge pans the structural viewport at
  the retained zoom level so offscreen objects can enter the active zone.
- Selected visible folders/files receive a restrained selection outline and
  can be moved together by dragging one selected object.
- Selection mode suppresses ordinary node focus/descent while active and does
  not participate in Runtime X-Ray corridor movement.

**Operational Interpretation Panel**
- Position: upper right while an object is focused
- `top: 16px`
- `right: 16px`
- Width: `min(320px, calc(100vw - 32px))`
- Max height: `calc(100% - 32px)`
- The always-expanded anchor contains identity plus architectural weight for a
  file, or identity plus regional density for a folder.
- File identity places a compact square source-inspection trigger directly beside the
  file name; territories do not show this trigger.
- Operational role or territory file-type counts, actions, and interaction memory render
  as collapsed semantic layers by default.
- Only one secondary semantic layer unfolds at a time; collapsed layers keep
  a faint one-line summary and compact chevron indicator.
- Interaction-memory residue uses a subdued warm marker only after earlier
  focus or Runtime X-Ray activation in the current analyzed session.
- Metric cells and action controls remain compact so the graph stays primary.
- Actions and runtime-origin selection use thin bordered instrument controls,
  inset activation accents, and restrained focus glow rather than solid
  dashboard buttons.
- For a selected folder, the Runtime origin selector exposes only
  first-degree file children of that territory; deeper origins require
  entering the nested region.
- The Runtime origin selector inherits the thin dark scroll channel and
  subdued teal interactive thumb when native dropdown scrolling is available.
- Native scrolling remains intact; the panel scrollbar is visual chrome only.
- The scrollbar uses a thin dark channel with a low-alpha teal thumb that
  brightens subtly while the panel or thumb is being used.

**Source Inspection Modal**
- Screen-fixed overlay above the graph and panels, opened only from a focused
  file's source trigger.
- Maximum surface: `980px` wide by `720px` high, bounded by viewport padding.
- A resizable narrow rail on the left stacks compact Operational Identity above
  Navigation; the dominant implementation/document field spans the wider,
  full-height working surface on the right.
- File name, compressed path, language, LOC, function count, and applicable
  runtime/document-mode state share a single compact header row; long paths
  truncate rather than increasing header height.
- Read-only monospace source viewport with dark surface and thin subdued teal
  native scrollbar.
- Indexed source and structured text token colors are provided deterministically
  through lazily loaded dark syntax grammars; plain `.txt` retains the same
  viewport with raw monochrome text.
- Markdown `.md` opens in a styled rendered-document viewport by default; an
  inline `Rendered` / `Raw` pill switch restores the syntax-colored raw text.
- Parsed function declaration lines expose a brand-cyan gutter cue; folding
  highlights the retained declaration row and residue in cyan, then compresses
  its body until reopened or navigated. The chevron occupies a fixed left
  gutter slot independent of line-number width.
- Activating a folded declaration converts the implementation field into a
  local Runtime Placement corridor: the focused function stays centered
  between up to three resolved incoming callers and two resolved outgoing calls.
  Relationships are keyed by concrete extracted waypoint identity; cross-file
  neighbors include their file path at reduced visual emphasis.
- Corridor lanes are presented as resolved flow and distinguish direct calls
  from JSX-rendered component links; this is structural placement, not
  execution telemetry.
- A deterministic top-level mount may appear as `Module Scope` with its file
  path when a focused function has no enclosing function caller, such as an
  application root rendered from an entry module.
- Navigation places an initially expanded `Operational Variables` layer
  directly under `Function Waypoints`; it shows parser-backed state surfaces,
  runtime handles, and structurally propagated projections with compact
  reference evidence.
- `Local Variables` begins collapsed beneath it and reports the number of
  suppressed local declarations until explicitly unfolded.
- Selecting a variable centers its first parser-reported occurrence; compact
  `Prev` / `Next` controls traverse later evidence lines.
- The focused occurrence receives subdued cyan line emphasis while the exact
  variable token is marked with a strong green signal; other detected
  influence lines retain restrained teal residue.
- The implementation-side pressure minimap is currently removed; navigation
  remains in the function and variable rails.
- Close affordances: square close control, `Escape`, or backdrop click.

**Raw History Inspector**
- Position: below the temporal scrubber
- `top: 342px`
- `left: 16px`
- Width: `min(320px, calc(100vw - 32px))`
- Max height: `260px`

**Runtime Scrubber**
- Position: lower left while Runtime X-Ray is active.
- `left: 16px`
- `bottom: 18px`
- Width: `min(360px, calc(100vw - 32px))`
- The rail is a one-pixel causal axis with discrete runtime waypoints.
- Traversed rail segments use restrained teal energy; the current point uses
  a compact diamond beacon marker rather than a round media-slider thumb.
- Commands and readouts use precision uppercase typography and static,
  low-amplitude glow states.
- Runtime progression commands are labeled `Restart`, `Traverse`, and `Hold`
  instead of media-player terminology.

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

**Folder Nodes**
- Source: `frontend/src/graph/layout.ts`
- Width: `246px`
- Height: `108px`
- Root-level and nested directories use this same folder presentation.
- Visible chrome uses the folder shape with a tab.

**File Nodes**
- Source: `frontend/src/graph/layout.ts`
- Width: `130px`
- Height: `180px`
- Files are intentionally vertical rectangles.
- Visible chrome uses the file shape with a folded corner.
- File identity places the basename first and the right-aligned extension on a
  second line, then renders only the parent path to avoid repeated filenames.
- The bottom metadata row displays lightweight `LOC` metrics and adds `/F`
  function count only for JS/TS-family and Python files.
- `LOC` and function counts use separate amber/violet cues to keep the
  two architectural weight readings distinct.
- File history residue sits at the right end of that bottom metadata row.
- Low-signal compression changes ambient opacity/chrome emphasis only; it does
  not change file-node dimensions or layout bounds.

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
- Collapsed timeline trigger uses the same mobile dock origin at `left: 16px`;
  `bottom: 16px`.
- Raw history inspector moves above the timeline at `bottom: 184px`.

At `max-width: 760px`:
- Breadcrumb stretches from `left: 16px` to `right: 16px`.
- Structural context panel uses `top: 292px`.

## Layout Rule

Do not add or move graph overlay panels, change node dimensions, or change structural colors without updating this file.
