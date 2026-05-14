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

## Interaction Language

**Hover**
Temporary visual feedback only.

Current rule:
- No metadata preview on hover.

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
