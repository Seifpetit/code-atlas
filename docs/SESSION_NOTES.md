# Session Notes

This is the rolling handoff for the latest meaningful Code Atlas production session.

Update this at the end of a session when work should be easy to resume without reading the full chat.

## Latest Session

Date:
- 2026-05-27

Completed:
- Created root `CONTEXT.md` as the derived session entry point and explicit handoff.
- Moved all other project Markdown files into `docs/`, preserving `docs/ai-prompts/`
  and `docs/ai-skills/` organization.
- Updated documentation and check-script references to the new paths.
- Preserved the prior product state: central attention composition and temporal
  scrubber polish remain the latest completed UI work.
- Added deterministic non-blank LOC for every visible file node and
  syntax-derived function counts only for JS/TS-family file nodes.
- Corrected the initial metric presentation so missing data from a stale
  analysis payload is not displayed as false `0L` / `0F` values.
- Added ambient-only low-signal compression using explicit deterministic rules
  with inspectable reasons.
- Preserved interaction and runtime behavior by routing compressed styling
  through the attention compositor without changing node bounds.
- Refactored the focused-object panel into an operational interpretation
  surface: file weight/role/actions and folder/domain density/gravity/actions.
- Kept exact relation trace hover controls, context entry, and Runtime X-Ray
  inside the compact action region while removing repeated metadata rows.
- Added stable category-specific color rules for every emitted file
  operational role without changing the deterministic role heuristics.
- Made the temporal scrubber collapsible into a `40px` timeline-icon control
  at its existing origin while preserving active temporal graph state.
- Restyled Runtime X-Ray progression as a causal waypoint instrument with a
  thin energized rail, beacon handle, and matching operational command
  controls without altering runtime logic.
- Restyled the operational interpretation panel's native scrollbar as a thin
  low-noise teal channel with brighter interactive feedback.
- Applied the same tactical native-scroll styling to the Runtime origin
  selector without changing selector behavior.
- Rendered contextual, lineage, and runtime connections below all node
  objects as restrained moving cut-lines while preserving straight geometry.
- Removed elevated Runtime X-Ray edge layering so active causal lines signal
  through stroke treatment rather than covering architectural objects.

Verified:
- Markdown location check passed: only root `CONTEXT.md` and
  `README_showcase.md` remain outside `docs/`.
- Stale documentation-path reference scan passed.
- `scripts/close-session-check.ps1` passed with the documentation verification
  description.
- `scripts/archive-pass-check.ps1 -BaseRef HEAD -HeadRef HEAD` executed
  successfully as a script sanity check.
- Backend build passed with `npm.cmd run build`.
- Frontend build passed with `npm.cmd run build`.
- Extractor smoke test verified metadata/compression output and confirmed a
  small entrypoint (`frontend/src/main.tsx`) remains uncompressed.
- Extractor contract assertion verified `.ts`/`.tsx` metrics and verified
  Markdown LOC is returned without a `functionCount` field.
- Frontend production build passed after the operational panel refactor.
- Frontend production build passed after operational role color mapping.
- Frontend production build passed after the stable-origin collapsible
  temporal scrubber implementation.
- Frontend production build passed after causal-instrument runtime scrubber and
  operational-control styling refinement.
- Frontend production build passed after operational-panel scrollbar
  refinement.
- Frontend production build passed after Runtime origin selector scrollbar
  refinement.
- Frontend production build passed after background cut-line connection
  rendering and runtime edge layering refinement.

Archive Updates:
- `CONTEXT.md`
- `docs/DECISIONS.md`
- `docs/VOCABULARY.md`
- `docs/BUGS.md` updated with the fixed false-zero metric display issue.
- `docs/UI_LAYOUT.md` updated for the file metric row and fixed-bound
  compression presentation.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` updated
  for the operational interpretation panel contract.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` updated
  for the operational-panel native scrollbar treatment.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` updated
  for background moving cut-line connection rendering.
- `docs/WORKFLOW.md`
- `docs/README.md`
- `docs/SESSION_NOTES.md`
- `docs/ai-prompts/archive-pass.md`
- `docs/ai-prompts/close-session.md`
- `docs/ai-skills/`
- `scripts/archive-pass-check.ps1`
- `scripts/close-session-check.ps1`

Open Issues:
- `Click Selection Sometimes Does Not Register` remains open in `docs/BUGS.md`.
- Hover previews and hover-driven relationship apparition remain disabled.
- Relationship line geometry is currently a straight-line baseline.

Next Likely Task:
- Visually evaluate moving cut-line clarity and operational panel density in
  the running app, then continue the existing node click reliability
  investigation.

Git Status:
- Markdown documentation relocation and the new root `CONTEXT.md` are intentional changes.
- Semantic compression implementation and documentation changes are intentional.
- `README_showcase.md` and `docs/demo.gif` remain showcase material.
