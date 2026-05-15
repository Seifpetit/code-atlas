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
The action of moving into a domain or folder.

UI action:
- Double-click an enterable object.

**Progressive Focus View**
The navigation model where the user sees one contextual layer at a time instead of the whole repo at once.

**Structural Descent**
The act of entering a domain or folder while keeping ancestor context visually present.

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

**Significance Propagation**
The rule that activity deep inside a subtree contributes a subtle signal to its ancestors.

Purpose:
- Helps users decide where to descend.
- Prevents important deep changes from being invisible at higher levels.

**Significance Residue**
The visual signal produced by significance propagation.

Examples:
- Soft glow.
- Small residue dot.
- Subtle container accent.

Rule:
- Residue is ambient. It should guide attention without becoming a dashboard badge wall.

**Room**
Informal UX term for a context. Entering a folder should feel like entering a room.

**Breadcrumb**
The path from root to the current context.

Example:
- `Root / frontend / components`

Purpose:
- Shows where the user is.
- Lets the user return to an ancestor context.

## UI Objects

**Object**
A visible thing in the atlas.

Implemented object types:
- Domain
- Folder
- File
- Path Anchor
- Edge
- Breadcrumb

**Domain**
A top-level structural area.

Examples:
- `frontend`
- `backend`
- `shared`
- `api`

Technical representation:
- React Flow node type: `domain`

**Folder**
A structural container below the domain level.

Examples:
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

**Structural File**
A file that appears in the atlas because it is part of repository topology.

Examples:
- `.ts`
- `.tsx`
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
A single temporary path shown when the user hovers a relationship stub or relation item.

Purpose:
- Provides traceability for one requested relationship without showing a network.

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
A temporal overlay that shows how the repository changed over time.

Purpose:
- Adds repository evolution without replacing the structural map.

Rule:
- History decorates structure; it does not become the primary canvas model.

**Timeline Panel**
The UI panel listing recent commits.

Purpose:
- Lets the user preview or select one commit at a time.

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

## Interaction Language

**Hover**
Temporary visual feedback only.

Current rule:
- No metadata preview on hover.
- No relationship apparition on node hover.
- Hover remains CSS-only until the pointer-event flicker bug is solved.

Reason:
- Hover preview caused flicker and is listed in `BUGS.md`.

**Click**
Focuses an object locally.

Expected result:
- The clicked object is emphasized.
- Related edges and neighboring objects are emphasized.
- Unrelated objects fade.
- Metadata appears in the details panel.

Technical name:
- `focusedNodeId`

**Double Click**
Enters an object if it can contain children.

Applies to:
- Domain
- Folder

Does not apply to:
- File

**Focus**
The stable selected neighborhood after clicking an object.

**Local Neighborhood**
The focused object plus directly connected visible objects and edges.

**Details Panel**
The right-side metadata panel shown after clicking an object.

Current rule:
- The details panel is click-driven, not hover-driven.

**Relation Lens**
The relationship section inside the details panel for the focused object.

Purpose:
- Summarizes imports, imported-by counts, outside-context relationships, and visible incoming/outgoing neighbors.
- Gives meaning to focused edges without relying on canvas geometry alone.

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
