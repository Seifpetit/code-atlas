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

Double-clicking an enterable object enters that selected object as the current context. The visible layer changes to that object's direct children while an in-canvas lineage chain preserves spatial continuity.

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

## 7. Structural Edges Use Orthogonal Lanes

Status:
- Superseded

Superseded by:
- 8. Relationships Are Apparition Overlays
- 9. Relationship Stubs Precede Exact Traces

Decision:
- Focused structural edges should use custom orthogonal routing with deterministic lane offsets.
- Outgoing relations leave from the right side of the focused object.
- Incoming relations enter the left side of the focused object.
- Multiple focused edges should fan out into separate lanes instead of sharing the same trace.

Rationale:
- Relationship lines must be traceable to their owning object.
- Overlapping curves make edges visually merge and force users to untangle geometry mentally.
- Orthogonal lanes better match the structural, architectural language of the product.

Implications:
- Structural edge rendering uses a custom React Flow edge type.
- Edge geometry is still available for exact temporary traces.
- Edge lanes are no longer the primary relationship display model.

## 8. Relationships Are Apparition Overlays

Status:
- Accepted

Decision:
- The default structural canvas must not render relationship networks.
- Clicking an object enters local focus mode and shows only a budgeted subset of that object's immediate relationships.
- Extra relationships are represented through counters and relation-lens text instead of more canvas lines.
- Hover remains CSS-only until a stable hover system exists.

Rationale:
- Structure is permanent; relationships are ephemeral.
- The canvas should feel like a calm structural space, not wiring infrastructure.
- Relationship truth belongs in the relation lens when it exceeds what the eye can trace comfortably.

Implications:
- `visibleEdges` are derived from `focusedNodeId` and an explicitly traced relationship, not from all current-context imports.
- Edge overlays must support understanding without becoming the main visual system.

## 9. Relationship Stubs Precede Exact Traces

Status:
- Accepted

Decision:
- Focusing an object should primarily show compact incoming/outgoing relationship stubs on the object.
- Relationship stubs show counts, such as incoming and outgoing totals.
- Exact relationship traces should appear only when hovering a specific stub or relation item.
- Relationship stubs are click/focus UI, not hover UI.

Rationale:
- Counts and activation communicate relationship presence without turning the canvas into wiring.
- Exact lines are useful only when the user asks to trace a specific relationship.
- The structural canvas should remain calm even in hover/focus states.

Implications:
- Node activation and relation stubs are the default relationship visualization.
- Full paths are temporary traces, not focus-mode infrastructure.
- The relation lens remains the place for fuller relationship truth.

## 10. History Is A Lightweight Overlay

Status:
- Superseded

Superseded by:
- 13. Architectural Time Exploration Is Primary

Decision:
- Repository history is shown as a timeline layer over the structural map.
- Structure remains the stable spatial world.
- Hovering a commit previews changed files.
- Clicking a commit persists changed-file highlighting.
- Commit history does not introduce diff comparison, impact analysis, AI interpretation, or semantic clustering in this cycle.

Rationale:
- Code Atlas should answer how a repository evolved without becoming a git client.
- Temporal information is useful when it helps users understand where change happened in the architecture.
- The canvas must remain calm, readable, and structurally oriented.

Implications:
- History data is added to the analysis result as `commits` and `fileHistory`.
- Timeline UI is separate from graph layout logic.
- Changed-file highlighting should decorate existing structural nodes instead of mutating the graph into a commit dashboard.

## 11. Commit Diff Mode Is A File State Overlay

Status:
- Paused

Decision:
- The explicit commit comparison UI is disabled for now.
- Base commit selection, target commit selection, compare actions, and diff summary UI are not part of the active product surface.
- Reusable backend diff extraction may remain available, but it should not drive the current structural navigation UI.

Rationale:
- The compare workflow created visual crowding and made the app feel closer to a git dashboard.
- The more important product problem is cross-layer ambiguity during structural descent.
- Timeline/history should contribute subtle structural significance rather than dominate navigation.

Implications:
- Timeline commits support preview/select behavior only.
- Commit comparison can be revisited later as a separate product mode if it supports spatial understanding without crowding.

## 12. Continuity-Preserving Structural Descent

Status:
- Accepted

Decision:
- Entering a folder/domain should not feel like a hard scene replacement.
- Ancestor contexts persist as non-interactive React Flow path anchor nodes.
- Path anchors form a linked in-canvas chain from `Root` to the current parent.
- The most recent parent anchor links to the current visible children.
- Child objects emerge below the lineage chain with camera recentering and lightweight transitions.
- Historical significance propagates upward so path anchors and containers can show subtle residue when activity exists deeper in the subtree.

Rationale:
- Users need confidence that descending into a layer leads toward meaningful information.
- A purely replaced context creates cross-layer ambiguity and weakens spatial memory.
- Structure is permanent; history contributes ambient significance without becoming a dashboard.

Implications:
- Path anchors are real React Flow nodes so the minimap reflects the navigated structural chain.
- Lineage links are structural containment links, not import/dependency relationships.
- Path anchors are click targets for jumping back to an ancestor layer, but they do not enter local focus mode.
- Collision resolution ignores path anchors so they do not push the current content layer.

## 13. Architectural Time Exploration Is Primary

Status:
- Accepted

Decision:
- Time is explored primarily through architectural states, temporal pressure, and landmarks.
- Raw commits are secondary evidence shown only after a temporal landmark is focused.
- The timeline surface is a temporal scrubber, not a commit list or git-history browser.

Rationale:
- Code Atlas should help users understand how architecture evolved, not browse git metadata first.
- Temporal pressure should diffuse into the structure so users can see where architectural activity accumulated.
- Commit evidence remains useful, but it should support architectural investigation rather than dominate the UI.

Implications:
- `TemporalScrubber` is the primary history UI.
- `RawHistoryInspector` is contextual and subordinate.
- Commit cards, base/target compare controls, and chronological dashboard surfaces should not return without a separate accepted product decision.

## 14. Node Attention Is Centrally Composed

Status:
- Accepted

Decision:
- Node highlighting is resolved through a central attention compositor.
- Features provide signals; they do not directly own final node emphasis.
- The final visual state determines the node's attention layer, opacity, scale, z-index, glow type, pulse, and label emphasis.

Rationale:
- Scattered highlight classes made the same object look important for unclear reasons.
- Highlighting represents interruption priority, so visual priority must be deterministic.
- Interaction focus, temporal pressure, structural guidance, and critical landmarks need distinct visual languages.

Implications:
- New attention-affecting features must pass through the attention compositor.
- Click/search focus has higher priority than temporal pressure.
- Temporal and structural signals may remain visible only when they do not visually compete with higher-priority states.

## 15. Structural Layout Uses Object-Type Columns

Status:
- Accepted

Decision:
- Each object grouping/type gets its own horizontal column.
- Objects in the same grouping/type are stacked vertically inside that column.

Rationale:
- The structural view should read as a horizontal tree branching from the current parent.
- One-column-per-type grouping makes the current layer easier to scan than mixed top-down geometry.
- It preserves grouping without requiring extra cluster nodes.

Implications:
- Layout should prioritize horizontal expansion before vertical stacking across groups.
- Type/group columns are a structural layout rule, not a semantic clustering mode.

## 16. Relationship Trace Geometry Is Currently Straight-Line Baseline

Status:
- Accepted

Decision:
- The current relationship/line renderer uses simple straight source-to-target segments.
- Fancy obstacle detours, orthogonal routers, and lane routers are not active in the current baseline.

Rationale:
- Router complexity produced confusing visual behavior and still failed to guarantee clarity.
- Straight lines make the baseline easier to evaluate while layout and attention hierarchy stabilize.
- Relationship lines remain secondary and should not become the main navigation language.

Implications:
- Future routing work should be evaluated against the straight-line baseline.
- If routes become complex again, the product question is whether geometry helps understanding more than layout, stubs, and panels.

## 17. Close Session Is A Separate Ritual From Archive Pass

Status:
- Accepted

Decision:
- Archive pass is the product-memory step.
- Close session is the full end-of-session ritual: verify, archive, update session notes, check git state, commit/push when requested, and hand off open loops.

Rationale:
- Archive docs preserve durable product intent, but they do not prove the work was verified or make the next session easy to resume.
- A lightweight close ritual reduces dependence on memory and discipline.
- `SESSION_NOTES.md` gives the next session a faster handoff than reading the full conversation.

Implications:
- Use `ai-prompts/close-session.md` for end-of-session closure.
- Use `scripts/close-session-check.ps1` as a local reminder/check.
- Keep `SESSION_NOTES.md` short and focused on the latest meaningful session.
