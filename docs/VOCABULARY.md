# Code Atlas Vocabulary

This document defines the shared language for the UI and interaction model. Use these terms in issues, design notes, code comments, and implementation discussions so intent stays clear.

## Product Concept

**Code Atlas**
The product. A spatial interface for understanding software structure through progressive navigation.

**Atlas**
The navigable visual space inside the graph canvas.

**Structural Explorer**
The current implemented experience. It shows deterministic repository topology: folders, files, containment, and imports.

**Clustering Profile**
The active interpretation mode for the atlas view.

Current profiles:
- **Structural**: implemented. Shows repository structure.
- **Functional**: planned. Disabled.
- **Runtime**: planned. Disabled.

## Navigation Concepts

**Context**
The current place the user is viewing. Example: `Root`, `frontend`, `src`, `components`.

**Current Context**
The active context whose direct children are visible.

Technical name:
- `currentContextId`

**Enter**
The action of moving into a folder.

UI action:
- Double-click an enterable object.

**Progressive Focus View**
The navigation model where the user sees one contextual layer at a time instead of the whole repo at once.

**Structural Descent**
The act of entering a folder while keeping ancestor context visually present.

Purpose:
- Preserves spatial memory.
- Reduces uncertainty about where the user came from.
- Makes navigation feel like descending into nested architecture.

**Path Anchor**
A non-interactive React Flow node that represents `Root` or an ancestor context during descent.

Purpose:
- Keeps the path visible inside the canvas.
- Keeps parent context visible.
- Gives the minimap real objects for the navigation chain.

Interaction:
- Click to jump directly to that context layer.
- Does not trigger local focus mode.

**Lineage Chain**
The linked series of path anchors from `Root` to the current parent.

Example:
- `Root -> frontend -> auth`

Purpose:
- Shows the user's descent path spatially, not only as external breadcrumb text.

**Current-Parent Fanout**
The containment links from the most recent path anchor to the currently visible children.

Purpose:
- Makes it clear that the current layer belongs to the selected parent.

**Corridor**
A visible structural context lane in the atlas.

Use this for:
- The current structural context.
- Any linked context opened from a file relationship.

Technical note:
- The base corridor is driven by `currentContextId`.
- Linked corridors are appended from relationship navigation.

**Corridor Spine**
The folder ancestry that anchors a corridor.

Includes:
- The visible path anchors from `Root` to the corridor context.
- The current-parent fanout from the last path anchor to the visible layer.

Rule:
- The origin corridor spine is the fixed anchor for corridor merge and duplicate
  detection.
- Child objects in the visible layer remain movable, including while recursive
  corridor mode is active.

Use this instead of:
- folder lineage of the corridor
- ancestry strip

**Origin Corridor**
The corridor where a relationship-following action starts.

Purpose:
- Names the left side of a relationship jump without implying it is always the
  first corridor.
- In recursive corridor mode, any linked corridor can become the next origin
  corridor.

**Target Corridor**
The corridor containing the file the user followed.

Use this instead of:
- teleported corridor
- destination room

**Linked Corridor**
A target corridor that remains visible after the user follows a file
relationship from another corridor.

Rule:
- Linked corridors accumulate until the user explicitly resets corridor mode.
- If the requested context is already visible, the existing corridor is reused
  instead of duplicating the same folder lineage.

Technical name:
- `linkedCorridors`

**Recursive Corridor Mode**
The interaction state where following file relationships creates a persistent
chain or network of linked corridors.

Rule:
- A linked corridor can become an origin corridor for another linked corridor.
- New relationship follows add or merge corridors; they do not clear previous
  corridor links.
- The only user-facing way to clear this mode is the Reset control.

**Corridor Merge**
The cleanup rule that reuses an already visible linked corridor when a new
relationship target belongs to the same context.

Purpose:
- Prevents duplicate folder corridors.
- Keeps converging lineage readable while preserving all relationship links.

**Shared Lineage**
The ancestor path that two or more corridors have in common.

Rule:
- Shared lineage should visually converge instead of repeating identical
  ancestor folders in each linked corridor.

**Corridor Link**
A cross-corridor relationship edge between an origin file and a target file.

Rule:
- Corridor links use direction color: outgoing imports use the right-side import
  color, incoming imported-by links use the left-side dependency color.
- Corridor links persist until recursive corridor mode is reset.

Technical name:
- `corridorLinks`

**Significance Propagation**
The rule that activity deep inside a subtree contributes a subtle signal to its ancestors.

Purpose:
- Helps users decide where to descend.
- Prevents important deep changes from being invisible at higher levels.

**Folder Significance Residue**
An ambient dot rendered only on folder nodes while propagated historical
activity is contextually active.

Rule:
- Files do not render this marker; their chrome stays reserved for format and
  direct interaction signals.
- Folder outlines and tabs remain visually stable rather than changing
  highlight state with the residue.

**Room**
Informal UX term for a context. Entering a folder should feel like entering a room.

**Breadcrumb**
The path from root to the current context.

Example:
- `Root / frontend / components`

Purpose:
- Shows where the user is.
- Lets the user return to an ancestor context.

**Structural Selection Tool**
An explicit toolbar mode for selecting a visible group of folder/file objects
with a dragged canvas zone and moving the selected group together.

Rule:
- Available for structural positioning only.
- An active dragged zone can auto-pan at canvas boundaries to include objects
  revealed beyond the initial viewport.
- While active, ordinary object focus and folder entry are suspended.
- Path anchors and Runtime X-Ray corridor manipulation are outside its scope.

**Risk X-Ray Mode**
An explicit graph tool that temporarily scans the current atlas and recolors
file chrome by deterministic refactor pressure.

Purpose:
- Helps users distinguish safe extraction candidates from high-risk behavior
  surfaces before starting a refactor.
- Shows refactor risk as inspectable pressure, not as an automated
  recommendation.

Rule:
- The mode does not alter layout, graph state, hierarchy, focus, relationships,
  runtime, or saved view state.
- File bodies stay neutral; only outline, folded-corner chrome, and a restrained
  behind-node glow switch to the refactor pressure palette.
- Folder nodes and lineage anchors keep their structural color language.

Current pressure colors:
- Green: Start Here.
- Blue: Foundation.
- Gold: Needs Isolation.
- Magenta: High-Leverage Risk.
- Red: Critical Surface.
- Slate: Stable.

Technical name:
- `refactorRiskMode`
- `refactorRiskTier`

**Code Weather Forecast**
The normal-inspection meaning of the focused-file Forecast entry.

Purpose:
- Answers what happens if the current repository continues evolving without
  intervention.
- Uses trajectory language such as `Stable`, `Warming`, `Under Pressure`,
  `High Risk`, or `Storm Forming`.

Rule:
- Does not show refactor suggestions or simulated file splits.
- Uses a three-question paginated flow: `Should I care?`, `Why is it flagged?`,
  and `What if I ignore it?`.
- Signals describe pressure movement: file size, dependency concentration,
  responsibility accumulation, coupling growth, and review complexity.

**Refactor Simulation**
The Risk X-Ray meaning of the focused-file forecast entry.

Purpose:
- Answers what one possible cleanup path could look like.
- Presents a possible separation of concerns, current structure, simulated
  architecture, and expected outcome cards.

Rule:
- Uses `possible separation`, never a single required-separation framing.
- Uses a three-question paginated flow: `What's wrong?`, `How to split it?`,
  and `Is it worth it?`.
- Exists only while Risk X-Ray mode is active.

## UI Objects

**Object**
A visible thing in the atlas.

Implemented object types:
- Folder
- File
- Path Anchor
- Edge
- Breadcrumb

**Folder**
A structural container at any repository depth, including root-level directories.

Examples:
- `frontend`
- `src`
- `components`
- `hooks`

Technical representation:
- React Flow node type: `folder`

**File**
An implementation unit.

Examples:
- `App.tsx`
- `auth.ts`
- `server.ts`

Technical representation:
- React Flow node type: `file`

**File Metrics**
Deterministic lightweight weight cues shown on every file node.

Current values:
- Non-blank lines of code, rendered as `L`.
- Syntax-derived function-like declaration count for parsed source modules, rendered as `F`.

UI format:
- `421L` followed by a centered separator and `14F`.

**Deterministic Semantic Compression**
An ambient visual treatment for files with explicit low-signal structural rules.

Purpose:
- Makes higher-signal implementation regions easier to see without deleting,
  merging, or semantically interpreting files.

Rules:
- Uses only filename conventions, non-blank LOC, syntax-derived function
  counts, pass-through export structure, and import-only Python package
  gateway structure.
- Compression is overridden by focus, search, temporal attention, and runtime states.

Technical name:
- `compressionLevel: "low-signal"`

**Low-Signal File**
A file that receives deterministic semantic compression.

Current reason values:
- `very-low-loc`
- `tiny-wrapper`
- `conventional-support-file`
- `pass-through-export`
- `package-gateway`

**Structural File**
A file that appears in the atlas because it is part of repository topology.

Examples:
- `.ts`
- `.tsx`
- `.py`
- `.md`
- `.json`
- `.yml`
- `.css`

Rule:
- Structural files are visible even when they are not parsed for imports.

**Import-Parsed File**
A file that the backend scans for import/export relationships.

Current examples:
- `.ts`
- `.tsx`
- `.js`
- `.jsx`
- `.mts`
- `.cts`
- `.mjs`
- `.cjs`
- `.py`

Rule:
- Import parsing is narrower than structural visibility.

**Structural-Only File**
A structural file that is visible in the atlas but is not scanned for import/export relationships.

Examples:
- `.md`
- `.json`
- `.yml`
- `.css`

UI rule:
- Structural-only files are grouped spatially by file type inside the current context.

**Edge**
A visible relationship between two objects.

Current structural meaning:
- Aggregated import relationship between visible objects.

Rule:
- Edges are secondary. They should stay calm, thin, and contextual.
- Edges are focus-revealed, not visible by default.

**Focus-Revealed Edge**
An edge shown only after clicking an object.

Purpose:
- Explains the focused object's local import neighborhood without turning the whole context into a dependency graph.

**Relationship Apparition**
A temporary relationship overlay that appears through click/focus and explicit relationship tracing.

Purpose:
- Lets relationships feel like contextual explanations rather than permanent wiring.

**Relationship Budget**
The maximum number of relationship traces allowed on the canvas for a focused object.

Purpose:
- Keeps relationship overlays traceable and prevents edge networks from taking over the structural view.

**Relationship Stub**
A compact directional count attached to a focused object.

Examples:
- Incoming count on the left side.
- Outgoing count on the right side.

Purpose:
- Communicates relationship presence without drawing full paths.

**Exact Relationship Trace**
A single temporary path shown when the user hovers a relation item.

Purpose:
- Provides traceability for one requested relationship without showing a network.

**Directional Relationship Trace**
A temporary set of budgeted visible paths shown when the user hovers the
focused object's incoming or outgoing stub or connected port.

Purpose:
- Shows visible fan-in or fan-out without exposing the full context network.

**Structural Edge**
A focus-revealed relationship trace in structural mode.

Purpose:
- Shows import relationships as temporary explanatory overlays, not permanent wiring.

**Outgoing Edge**
A focus-revealed edge from the focused object to something it imports.

Purpose:
- Shows what the focused object depends on.

**Incoming Edge**
A focus-revealed edge from something that imports the focused object.

Purpose:
- Shows what depends on the focused object.

**History Layer**
A temporal overlay that shows architectural pressure and evidence over time.

Purpose:
- Adds repository evolution without replacing the structural map.

Rule:
- History decorates structure; it does not become the primary canvas model.

**Architectural Time**
The primary temporal exploration layer.

Purpose:
- Lets the user scrub through architecture evolution rather than browse commits first.
- Shows temporal pressure, landmarks, and affected regions inside the spatial atlas.

Technical components:
- `TemporalScrubber`
- `buildTemporalStates`
- `extractArchitecturalLandmarks`

**Temporal Scrubber**
The compact timeline control for architectural time exploration.

Purpose:
- Lets the user move through temporal states.
- Shows landmark points and a smooth progress track.
- Can collapse to a `40px` timeline-icon trigger at the same spatial origin;
  collapse hides the temporal controls and secondary raw-history evidence,
  while preserving the active temporal state on the graph.

Technical name:
- `TemporalScrubber`

**Temporal Pressure**
The accumulated historical activity signal for a node or subtree.

Purpose:
- Shows where change, volatility, or repeated activity accumulated over time.
- Feels atmospheric rather than like a click or search highlight.

Technical name:
- `nodeTemporalPressure`

**Architectural Landmark**
A significant temporal moment derived from repository activity.

Examples:
- Dependency expansion.
- Volatility surge.
- Subsystem emergence.
- Coupling shift.

Purpose:
- Helps users focus on meaningful architectural states instead of raw commit-by-commit history.

Technical name:
- `ArchitecturalLandmark`

**Raw History Inspector**
The contextual evidence panel shown after focusing an architectural landmark.

Purpose:
- Shows commit evidence, authors, files changed, and nearby implementation details.
- Remains secondary to architectural time exploration.

Technical name:
- `RawHistoryInspector`

**Runtime Scrubber**
The Runtime X-Ray instrument for stepping through the derived causal corridor.

Purpose:
- Exposes runtime progression as discrete architectural waypoints rather than
  generic percentage progress.
- Uses a thin energized rail and compact beacon handle while preserving the
  existing runtime sequence and playback behavior.

Technical name:
- `RuntimeScrubber`

**Timeline Panel**
Older name for the temporal panel area.

Purpose:
- Use `Temporal Scrubber` for the active component.
- Use `Raw History Inspector` for the secondary evidence panel.

Status:
- Deprecated as a commit-list concept.

**Commit Preview**
A temporary changed-file highlight caused by hovering a commit.

Purpose:
- Shows where a commit touched the current structural context without committing to a persistent selection.

**Selected Commit**
The single persisted commit selection in the timeline.

Purpose:
- Keeps changed-file highlights visible until the selection is cleared or replaced.

**Changed File Highlight**
A visual decoration on files or containing folders touched by the active commit.

Purpose:
- Shows where change happened while preserving structural readability.

**File History Metadata**
Per-file history information such as commit count, last modified date, authors, and recent commits.

Purpose:
- Adds temporal context to the file details panel without opening a git client.

**Commit Diff Mode**
Paused concept for comparing one base commit against one target commit.

Purpose:
- Shows what changed between two commits at the architecture level.

Rule:
- Diff mode is not active in the current UI.
- Do not expose base/target/compare controls until this mode is intentionally resumed.

**Base Commit**
Paused diff-mode term for the older or starting commit selected for comparison.

Purpose:
- Defines the before state of the comparison.

**Target Commit**
Paused diff-mode term for the newer or ending commit selected for comparison.

Purpose:
- Defines the after state of the comparison.

**Diff Overlay**
Paused diff-mode visual layer applied to structural nodes during commit comparison.

Purpose:
- Shows changed areas spatially without changing the structural layout.

**Diff Summary Panel**
A paused diff-mode panel concept showing base/target commits, changed file counts, status counts, and additions/deletions.

Purpose:
- Holds comparison truth without making the canvas noisy.

**File Change State**
The per-file status returned by git diff.

Values:
- `added`
- `modified`
- `deleted`
- `renamed`

Purpose:
- Drives the diff overlay visual treatment.

**Edge Lane**
A deterministic offset path used to separate multiple focused edges.

Purpose:
- Prevents relationship traces from overlapping and visually merging.

**Orthogonal Edge**
An edge that uses horizontal/vertical stepped geometry instead of organic curves.

Purpose:
- Improves traceability and reinforces the structural language of the atlas.

**Straight Relationship Trace**
The current baseline geometry for relationship and lineage lines.

Purpose:
- Draws the simplest possible source-to-target line so layout clarity can be evaluated before adding routing complexity.

Rule:
- Straight traces are the current baseline, not a claim that routing will never return.

**Cut-Line Trace**
A thin moving segmented connection line rendered behind atlas objects.

Purpose:
- Keeps requested relationships, lineage, and runtime causality legible while
  objects remain visually dominant.

Rule:
- Line segments may vary in color and pace by relationship type, but no
  connection line rises above a node card.

## Interaction Language

**Hover**
Temporary visual feedback only.

Current rule:
- No metadata preview on hover.
- No relationship apparition on node hover.
- Hover remains CSS-only until the pointer-event flicker bug is solved.

Reason:
- Hover preview caused flicker and is listed in `docs/BUGS.md`.

**Click**
Focuses an object locally.

Expected result:
- The clicked object is emphasized.
- Related edges and neighboring objects are emphasized.
- Unrelated objects fade.
- Metadata appears in the details panel.

Technical name:
- `focusedNodeId`

**Relationship Follow**
The action of choosing a connected file from the metadata panel.

Expected result:
- If the target file is already in the active corridor, the camera recenters on
  that file.
- If the target file belongs to another context, recursive corridor mode opens
  or reuses a linked corridor and draws a corridor link.

Use this instead of:
- teleport

**Focus Handoff**
The one-time camera movement that centers the file selected by a relationship
follow.

Rule:
- A focus handoff happens only when the target corridor is first opened or
  reused for that selected target.
- After the handoff, ordinary camera movement remains under user control.

**Reset Corridors**
The explicit control that exits recursive corridor mode.

Rule:
- Reset clears linked corridors and corridor links.
- Other navigation actions must not silently reset recursive corridor mode.

Technical name:
- `handleResetCorridors`

**Double Click**
Enters an object if it can contain children.

Applies to:
- Folder

Does not apply to:
- File

**Focus**
The stable selected neighborhood after clicking an object.

**Local Neighborhood**
The focused object plus directly connected visible objects and edges.

**Attention Compositor**
The central system that decides a node's final visual emphasis.

Purpose:
- Prevents hover, focus, temporal pressure, structural guidance, and landmarks from competing randomly.
- Makes highlighting represent interruption priority.

Technical name:
- `composeNodeVisualState`

**Attention Layer**
The winning attention category for a node.

Current layers:
- `ambient`
- `compressed`
- `hover`
- `focus`
- `structural-guidance`
- `temporal-pressure`
- `critical-event`

Rule:
- Higher-priority layers suppress weaker competing signals.

**Node Visual State**
The final composed visual state applied to a node.

Includes:
- opacity
- scale
- z-index
- outline intensity
- glow type
- pulse
- label emphasis

Technical name:
- `NodeVisualState`

**Details Panel**
The right-side operational interpretation surface shown after clicking an
object.

Current rule:
- The details panel is click-driven, not hover-driven.
- Its always-visible anchor identifies the focused object and exposes
  deterministic architectural weight or regional density.
- Secondary semantic layers begin collapsed, retain faint summaries, and
  unfold one at a time through explicit user action.
- Files unfold `Operational Role` and `Activation Surface`.
- Folders unfold `File Types` and `Regional Actions`.
- `Interaction Memory` is session-scoped residue indicating previous focus or
  Runtime X-Ray activation for the selected object.
- A focused file's identity anchor includes a square source-inspection control
  that opens its captured content in a read-only modal.
- Each emitted operational role category receives a stable accent color; the
  color identifies the rule category and is not a semantic-confidence score.
- Its native scroll channel uses thin subdued tactical chrome, becoming
  brighter only during direct panel interaction.
- Native Runtime origin dropdown scrolling uses the same tactical channel
  styling where the browser exposes select scrollbar chrome.

**Semantic Layer**
A collapsible secondary region inside the details panel.

Purpose:
- Makes deeper operational meaning available without exposing every detail
  simultaneously.

Rule:
- A collapsed semantic layer still presents its title and concise residue
  summary; only one secondary layer opens at a time.

**Interaction Memory**
Subtle in-session residue for an object previously explored in the panel or
activated as a Runtime X-Ray file origin.

Rule:
- Interaction memory is local to the current analyzed graph and is not
  repository history or persisted analytics.

**Source Inspection Modal**
A screen-fixed, read-only content surface opened from the source control beside a
focused file name.

Purpose:
- Reveals exact file contents only after deliberate user request while the
  panel remains a compact operational interpretation surface.

Rule:
- The modal is not part of graph coordinates and does not modify Runtime
  X-Ray, hierarchy, semantic compression, or attention behavior.
- Indexed source and structured text formats use deterministic syntax coloring,
  including JS/TS, Python, markup, documentation, config, styles, and shell
  scripts; plain `.txt` remains uncolored raw source.
- Markdown `.md` content starts as a safely rendered GFM document and can be
  switched to syntax-colored raw source through a compact pill control.
- Highlighting code and individual language grammars load only when source
  inspection requires them.

**Relation Lens**
The compact visible-connection tracing controls inside the focused object's
action region.

Purpose:
- Keeps directional trace activation on incoming/outgoing ports and exact
  single-trace activation on individual visible connections.
- Leaves architectural weight and territorial interpretation to their
  dedicated regions instead of duplicating metrics.

## Layout Concepts

**Visible Layer**
The set of direct children shown for the current context.

Rule:
- Only one structural level is rendered at a time.

**Direct Children**
Objects whose parent is the current context.

Example:
- If current context is `frontend`, visible children may include `src`, `public`, `package.json`.

**Node Budget**
The maximum number of visible entities allowed before paging.

Current target:
- 10-30 visible objects.

Current technical cap:
- 30 visible children per page.

**Page**
A subset of a large context when it has more children than the node budget.

Purpose:
- Prevents graph explosion.
- Keeps the viewport readable.

**Overview**
The root context view.

UI action:
- The Overview button returns to `Root`.

**Object-Type Column**
A horizontal layout column for one structural object grouping/type.

Purpose:
- Keeps folders, source files, and structural-only file groups visually separated.
- Makes the current layer read as horizontal branches from the current parent.

Rule:
- Each object grouping/type gets one X column.
- Objects within that grouping stack vertically.

## Spatial Concepts

**Canvas**
The React Flow surface where atlas objects render.

**Minimap**
The small orientation map inside React Flow.

Purpose:
- Shows the current structural context and node distribution.

Rule:
- The minimap should reflect the current visible context, not the full repository.

**Camera**
The viewport position and zoom in React Flow.

Rule:
- Camera movement should recenter the current context.
- Entering a deeper context retains the active zoom and centers the local
  lineage-to-children corridor, rather than fitting every visible object.
- Returning to an ancestor context preserves that zoom continuity and
  recenters its local corridor by the same rule.
- Camera movement should not reveal deeper hierarchy.

**Zoom**
Scale only.

Rule:
- Zoom must not reveal more nodes.
- Zoom is not navigation.

## Technical Mapping

**Structural State**
The state that drives the structural explorer.

Suggested shape:

```ts
type StructuralState = {
  currentContextId: string | null;
  focusedNodeId: string | null;
  pageIndex: number;
  breadcrumbPath: string[];
  clusteringMode: ClusteringMode;
};
```

**Context Projection**
The derived visible graph for the current context.

Technical function:
- `layoutStructuralContext`

Output:
- visible nodes
- contextual edges
- breadcrumb path
- page metadata

**Full Repo Graph**
The complete parsed repository graph from the backend.

Rule:
- The renderer should not render the full repo graph directly.
- The renderer should consume the current context projection.

## Workflow Language

**Archive Pass**
The memory-preservation step for durable product context.

Purpose:
- Updates `docs/VOCABULARY.md`, `docs/DECISIONS.md`, and `docs/BUGS.md` when product intent, language, decisions, or known issues changed.

Prompt:
- `docs/ai-prompts/archive-pass.md`

**Close Session**
The full end-of-session ritual.

Purpose:
- Verifies work, runs archive updates when needed, updates detailed notes and the root context handoff, checks git state, and prepares commit/push when requested.

Prompt:
- `docs/ai-prompts/close-session.md`

**Session Notes**
The rolling handoff file for the latest meaningful session.

Purpose:
- Records completed work, verification, archive updates, open issues, next likely task, and git status.

Technical file:
- `docs/SESSION_NOTES.md`

**Context Document**
The root resume summary derived from detailed context records and the latest session notes.

Purpose:
- Gives each new session one immediate starting point.
- Holds an explicit `Current Handoff` refreshed at close session.

Technical file:
- `CONTEXT.md`

## Words To Avoid

Avoid these when describing the intended UX:
- Infinite zoom
- Graph dump
- Full graph view
- Expand everything
- Reveal all descendants
- Dependency chaos

Prefer these:
- Enter context
- Current room
- Visible layer
- Local neighborhood
- Progressive focus
- Structural profile
- Context projection
