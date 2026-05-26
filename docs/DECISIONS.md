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
- Superseded by Decision 20

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
- Extra relationships are represented through node stub counters and compact
  visible-connection trace controls instead of more canvas lines.
- Hover remains CSS-only until a stable hover system exists.

Rationale:
- Structure is permanent; relationships are ephemeral.
- The canvas should feel like a calm structural space, not wiring infrastructure.
- Relationship trace activation belongs in the focused object's action region
  when it exceeds what the eye can trace comfortably.

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
- The action region retains compact relation trace controls; architectural
  counts belong in weight or density interpretation.

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
- `docs/SESSION_NOTES.md` provides the detailed handoff, while root `CONTEXT.md` provides the fastest resume summary.

Implications:
- Use `docs/ai-prompts/close-session.md` for end-of-session closure.
- Use `scripts/close-session-check.ps1` as a local reminder/check.
- Keep `docs/SESSION_NOTES.md` short and focused on the latest meaningful session.
- Refresh root `CONTEXT.md` with an explicit current handoff at close session.

## 18. Documentation Records Live Under Docs With A Root Context Entry Point

Status:
- Accepted

Decision:
- Markdown documentation records, prompt specs, and skill specs live under `docs/`.
- Root `CONTEXT.md` remains outside that folder as the first resume point.
- Root `README_showcase.md` remains outside that folder as showcase material.

Rationale:
- Context material is easier to navigate when grouped in one documentation location.
- A visible root context file lets a new session resume immediately without replacing detailed source records.

Implications:
- Use `docs/WORKFLOW.md`, `docs/VOCABULARY.md`, `docs/DECISIONS.md`,
  `docs/BUGS.md`, `docs/UI_LAYOUT.md`, and `docs/SESSION_NOTES.md`.
- Use `docs/ai-prompts/` and `docs/ai-skills/` for maintenance instructions.
- Close session updates the detailed notes and then refreshes root `CONTEXT.md`.

## 19. Semantic Compression Is Deterministic And Ambient-Only

Status:
- Accepted

Decision:
- Every visible file node exposes non-blank lines of code as lightweight metadata.
- JS/TS-family file nodes additionally expose a syntax-derived function count.
- Low-signal files are classified only through deterministic rules: very low LOC, small conventionally named support modules, small named wrappers/helpers/adapters, and pass-through export modules.
- Low-signal classification produces a calm ambient presentation and lower default ordering weight; it does not remove, merge, or hide files.

Rationale:
- Structural views become noisy when boilerplate and forwarding files compete visually with implementation-heavy regions.
- Immediate `LOC` and function-count cues make architectural weight inspectable without adding interpretation or AI.
- Ambient-only compression preserves the existing navigation and attention hierarchy.

Implications:
- Compressed files retain normal node bounds, containment, relationship data, and click behavior.
- Focus, search, temporal attention, and runtime corridor states override the compressed ambient presentation.
- Classification reasons must be exposed in the data contract and available in the focused details panel.

## 20. The Details Panel Is An Operational Interpretation Surface

Status:
- Accepted

Decision:
- The focused-object panel is organized into four compact regions rather than
  presenting a generic metadata list.
- Files show identity, deterministic architectural weight, heuristic
  operational role, and activation surface.
- Domains and folders show identity, recursive regional density, deterministic
  dominant gravity, and regional actions.
- Operational labels use only path/name conventions, extracted metrics,
  compression reasons, and import graph relationships; they remain candidates
  or rule-derived signals rather than semantic claims.
- Each operational role category uses a deterministic accent color keyed by
  its rule type; colors distinguish roles rather than claiming severity or
  certainty.
- Existing visible-connection trace hover controls remain available inside the
  action region, while low-value repeated parent/path/history and
  outside-context summary rows are not shown by default.

Rationale:
- The canvas already communicates hierarchy and spatial placement; repeating
  those values in a panel does not reduce uncertainty.
- LOC, function counts, dependency counts, and regional aggregates provide
  useful local architectural weight without AI interpretation.
- Actions should expose existing capabilities such as context entry, exact
  relationship trace, and Runtime X-Ray without implying unavailable tools.

Implications:
- The panel refactor must not modify runtime corridors, hierarchy unfolding,
  attention composition, or semantic compression behavior.
- Region totals are derived from existing graph nodes and edges; no backend
  semantic analysis is required.
- Native panel scrolling is preserved while its scrollbar chrome is rendered
  as a thin, low-noise teal channel with restrained interactive emphasis.
- The native Runtime origin selector uses matching scroll chrome where the
  browser exposes dropdown scrollbar styling.

## 21. The Temporal Scrubber Collapses At A Stable Origin

Status:
- Accepted

Decision:
- The expanded temporal scrubber retains its established panel dimensions.
- It can collapse into a `40px` by `40px` timeline-icon button at the same
  origin as the expanded panel.
- Collapsing removes the scrubber chrome and subordinate raw-history inspector
  from view without resetting the current temporal selection or graph
  attention state.

Rationale:
- Architectural time should remain immediately accessible without permanently
  occupying canvas space.
- A stable-origin trigger preserves spatial predictability when toggling the
  temporal surface.

Implications:
- Runtime X-Ray continues to replace the temporal surface normally.
- Desktop and responsive placements keep the trigger aligned to the
  corresponding expanded-panel origin.

## 22. Runtime Controls Use Causal Instrument Language

Status:
- Accepted

Decision:
- The Runtime X-Ray scrubber is presented as a causal waypoint instrument:
  thin rail, discrete chain points, restrained energized residue, and a
  compact beacon-shaped handle.
- Runtime and operational-panel controls use thin bordered command surfaces,
  precision typography, and low-amplitude activation/focus glow.
- Runtime command language uses `Restart`, `Traverse`, and `Hold` rather than
  media-player labels.
- This is a visual and interaction-language treatment only; runtime chain
  selection, playback handlers, corridor placement, and attention behavior
  remain unchanged.

Rationale:
- Runtime progression represents movement through architectural causality, not
  media playback or a generic settings value.
- Matching the corridor and HUD language prevents controls from visually
  detaching from the spatial model.

## 23. Connection Lines Stay Behind Objects As Moving Cut-Lines

Status:
- Accepted

Decision:
- Contextual relationship traces, lineage links, and Runtime X-Ray corridor
  lines render in the graph background plane beneath every node object.
- All visible connection variants use thin moving segmented strokes, with
  color and speed retaining their existing relationship distinctions.
- Reduced-motion preferences suppress segment motion.

Rationale:
- Lines should explain connection and causality without covering the primary
  architectural objects.
- Segmented motion communicates live direction while maintaining the calm,
  secondary role of graph connections.

Implications:
- Runtime edge emphasis uses stroke treatment rather than raising edge layer
  priority over nodes.
- Straight-line geometry remains the current routing baseline.
