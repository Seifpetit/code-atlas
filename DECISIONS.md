# Product Decisions

## 1. View Is Based On Clustering Profile

The graph view is determined by the active clustering profile type.

Current profiles:
- `structural`
- `functional`
- `runtime`

Default profile:
- `structural`

Only `structural` is implemented right now. `functional` and `runtime` exist as disabled UI options so the architecture can support future profile-specific renderers without mixing their logic into structural mode.

## 2. Progressive Focus View

The interface uses contextual progressive disclosure instead of infinite zoom.

Double-clicking an enterable object enters that selected object as the current context. The visible graph is then replaced by the direct children of that context, preserving orientation through breadcrumbs.

## 3. Structural Visibility Is Broader Than Import Parsing

Status:
- Accepted

Decision:
- Structural mode should show common repository files such as Markdown, JSON, YAML, CSS, scripts, and source files.
- Import parsing should remain limited to JS/TS source-like files for now.

Rationale:
- Structural exploration is about repository topology, not only code imports.
- Folders such as `ai-skills` must be enterable when they contain documentation files.
- Import edge extraction should stay focused and avoid pretending every file type has dependency semantics.

Implications:
- The backend separates structural file visibility from import-parsed files.
- A file can appear in the atlas without contributing import edges.

## 4. Structural-Only Files Are Grouped By Type

Status:
- Accepted

Decision:
- Structural-only files should be spatially grouped by file type in structural mode.

Rationale:
- Files that do not participate in import parsing are easier to understand as type groups.
- This keeps documentation, config, styles, scripts, and other support files readable without implying import relationships.

Implications:
- The UI clusters structural-only files through layout, not by adding a new React Flow cluster object.
- Domain, folder, and file remain the only structural node object types.

## 5. Edges Are Focus-Revealed, Not Always Visible

Status:
- Accepted

Decision:
- Structural mode should not show dependency edges by default.
- Clicking an object reveals only the import edges directly connected to that focused object.

Rationale:
- Always-visible edges create visual noise and make the structural view feel like a raw dependency graph.
- Edges are secondary context, not the main navigation surface.
- A focused edge neighborhood is easier to understand than a context full of lines.

Implications:
- The default view prioritizes spatial structure and object grouping.
- Import relationships are available on demand through click focus.
- React Flow connection handles should not be visually prominent in read-only navigation mode.

## 6. Focused Relations Use A Relation Lens

Status:
- Accepted

Decision:
- Clicking an object should show a relation lens in the details panel.
- The relation lens summarizes imports, imported-by counts, outside-context relationships, and visible incoming/outgoing neighbors.
- Directional edge styling is used only inside the focused relation neighborhood.

Rationale:
- Lines alone are not enough to explain relationships.
- A compact relation summary gives meaning before the user has to interpret edge geometry.
- Incoming and outgoing relationships answer different questions and should be visually distinct.

Implications:
- Relation understanding is primarily panel-supported, with graph edges as supporting evidence.
- Outgoing and incoming edges can use different calm styles.
- Relation UI should remain tied to focused objects, not default canvas state.
