# Code Atlas Context

This file is a session entry point derived from the existing project context
records. It does not replace them.

## Source Records

Read these files for authoritative detail:

| File | Authority |
| --- | --- |
| `docs/WORKFLOW.md` | Production workflow, archive pass, and close-session procedure. |
| `docs/VOCABULARY.md` | Canonical product and interaction terminology. |
| `docs/DECISIONS.md` | Accepted, paused, and superseded product decisions. |
| `docs/BUGS.md` | Known issues, fixes, and constraints from failed attempts. |
| `docs/UI_LAYOUT.md` | Explicit visual dimensions, positions, and color roles. |
| `docs/SESSION_NOTES.md` | Detailed handoff record for the latest session. |
| `docs/README.md` | Product setup, deployment, and API documentation. |

If this summary conflicts with any source record, the source record wins and
this file should be refreshed.

## Product Summary

- Code Atlas visualizes repository structure as a spatial atlas.
- Only the `structural` clustering profile is implemented; `functional` and
  `runtime` remain future profile directions.
- Navigation is progressive: double-click enters a domain or folder, while path
  anchors and a lineage chain preserve structural context.
- Relationships are focus-revealed overlays rather than permanent canvas
  wiring. Exact traces are temporary and the current geometry baseline is
  straight source-to-target lines.
- Visible relationship, lineage, and runtime connections render as moving
  cut-lines behind node objects so architecture remains foregrounded.
- Architectural time is explored through a temporal scrubber; raw commit
  evidence is subordinate to structural exploration.
- Node emphasis is centrally resolved through the attention compositor.
- File nodes display deterministic `LOC` weight cues, adding `F` only on
  JS/TS-family files; rule-classified low-signal files receive an ambient-only
  calm presentation.
- The focused-object panel is an operational interpretation surface: files
  expose weight, role signals, and actions; territories expose density,
  dominant gravity, and regional actions.
- The panel progressively discloses meaning: identity and mass stay visible,
  while summary-bearing semantic layers unfold intentionally one at a time.
- Focused file anchors expose deliberate raw-source inspection in a fixed
  read-only modal, backed by captured source text from analysis.
- The raw-source modal lazily applies deterministic JS/TS/JSX/TSX/JSON/CSS
  syntax coloring; unmapped indexed formats remain raw text.

## Working Rules

- Before major UI or architecture work, read `docs/VOCABULARY.md`,
  `docs/DECISIONS.md`, and `docs/BUGS.md`; read `docs/UI_LAYOUT.md` for
  layout or visual changes.
- Update `docs/VOCABULARY.md` only for durable shared terminology.
- Update `docs/DECISIONS.md` only for accepted, reversed, paused, or superseded
  direction.
- Update `docs/BUGS.md` when an observed issue is introduced, fixed, deferred, or
  forces a feature fallback.
- Keep hover previews and hover-driven relationship apparition disabled unless
  the recorded flicker issues are deliberately resolved.

## Session Handoff Rule

At the end of each meaningful session, update the `Current Handoff` section in
this file so that a new session can begin here. Also follow the existing close
session process in `docs/WORKFLOW.md` and `docs/ai-prompts/close-session.md`,
including updates to `docs/SESSION_NOTES.md` where required by that process.

The handoff should explicitly record:

- date
- completed work
- verification result
- context/archive documents updated, or `None`
- open issues
- next task
- relevant git state

## Current Handoff

Date:
- 2026-05-27

Completed:
- Added this derived root context entry point for smooth session resume.
- Consolidated Markdown documentation under `docs/`, excluding this file and
  `README_showcase.md` as requested.
- Kept detailed records, prompts, and skill files intact under their new
  documented paths.
- Implemented deterministic non-blank LOC for every visible file and
  syntax-derived function counts only for JS/TS-family files.
- Fixed missing-metric rendering so stale analysis payloads no longer appear
  as false `0L` / `0F` values.
- Implemented low-signal semantic compression based on explicit filename,
  size, wrapper, and pass-through export rules.
- Routed compressed presentation through the attention compositor so focus,
  temporal attention, and runtime corridors override it normally.
- Refactored the focused details panel into four operational regions for files
  and territories using deterministic graph-derived signals only.
- Preserved existing `Enter`, relationship trace hover, and `Runtime X-Ray`
  actions inside the new compact activation regions.
- Added deterministic per-category color accents for every file operational
  role; the palette differentiates rule types rather than implying confidence.
- Made the temporal scrubber collapsible into a `40px` timeline-icon trigger
  at its established origin without resetting active temporal emphasis.
- Refined Runtime X-Ray and operational-panel controls into a causal
  instrument language: waypoint rail, beacon marker, and restrained command
  chrome, with runtime behavior unchanged.
- Restyled the operational interpretation panel's native scrollbar into a
  thin, low-noise teal instrument channel without changing scroll behavior.
- Extended that native-scroll styling to the Runtime origin selector where
  browser popup chrome supports CSS theming.
- Placed contextual, lineage, and runtime connection lines behind every node
  object and applied thin moving cut-line styling with reduced-motion support.
- Removed active runtime edge elevation so corridor emphasis does not cover
  graph objects.
- Restricted territory Runtime origin selectors to direct child files so
  nested origins remain part of progressive hierarchy entry.
- Refactored the operational panel into a persistent identity/weight anchor
  with collapsed role/gravity, actions, and interaction-memory layers.
- Added session-local exploration residue for previously focused objects and
  Runtime X-Ray file origins without modifying graph attention.
- Added a square raw-source trigger beside focused file names and a
  screen-fixed code modal; indexed source text is retained in the analysis
  payload because temporary clones are cleaned after analysis.
- Added lazy Shiki syntax coloring with per-language loading and caching for
  JavaScript-ecosystem source inspection only.

Verification:
- Confirmed only `CONTEXT.md` and `README_showcase.md` remain outside `docs/`
  among project-authored Markdown files.
- Confirmed there are no stale references to the previous Markdown locations.
- Ran `scripts/close-session-check.ps1` successfully with documentation
  relocation verification.
- Ran `scripts/archive-pass-check.ps1 -BaseRef HEAD -HeadRef HEAD`
  successfully as a script sanity check.
- Backend build passed with `npm.cmd run build`.
- Frontend build passed with `npm.cmd run build`.
- Extractor smoke test emitted metrics and low-signal reasons and confirmed
  `frontend/src/main.tsx` is not compressed by the small-wrapper rule.
- Verified `.ts` and `.tsx` nodes include LOC/function counts while a Markdown
  node includes LOC with no `functionCount` property.
- Frontend production build passed after the operational panel refactor.
- Frontend production build passed after operational role color mapping.
- Frontend production build passed after the stable-origin collapsible
  temporal scrubber implementation.
- Frontend production build passed after causal-instrument runtime scrubber and
  operational-control styling refinement.
- Frontend production build passed after operational-panel native scrollbar
  refinement.
- Frontend production build passed after Runtime origin selector native
  scrollbar refinement.
- Frontend production build passed after background cut-line connection
  rendering and runtime edge layering refinement.
- Frontend production build passed after direct-child Runtime origin
  filtering and progressive metadata-panel disclosure.
- Backend and frontend production builds passed after raw-source payload and
  modal implementation.
- Frontend production build passed after lazy deterministic syntax coloring.

Context/Archive Documents Updated:
- `docs/WORKFLOW.md`
- `docs/VOCABULARY.md`
- `docs/DECISIONS.md`
- `docs/SESSION_NOTES.md`
- `docs/UI_LAYOUT.md` and `docs/DECISIONS.md` document the native scrollbar
  visual treatment for the operational panel.
- `docs/README.md`
- `docs/BUGS.md` records the fixed false-zero metric display issue.
- `docs/UI_LAYOUT.md` records the conditional file-metric row and fixed-bound
  compression presentation.
- `docs/ai-prompts/archive-pass.md`
- `docs/ai-prompts/close-session.md`
- `docs/ai-skills/`
- `scripts/archive-pass-check.ps1`
- `scripts/close-session-check.ps1`
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, `docs/UI_LAYOUT.md`, and
  `docs/README.md` document deterministic semantic compression and file metrics.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` document
  the operational interpretation panel contract.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` document
  the stable-origin temporal scrubber collapse behavior.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` document
  the runtime causal-instrument control treatment.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` document
  the moving cut-line connection layer treatment.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, and `docs/UI_LAYOUT.md` document
  progressive semantic layers, interaction memory, and direct-child Runtime
  origin selection.
- `docs/DECISIONS.md`, `docs/VOCABULARY.md`, `docs/UI_LAYOUT.md`, and
  `docs/README.md` document the raw-source modal and its captured-text
  analysis contract.
- Those records also document on-demand JavaScript-ecosystem syntax coloring
  and raw-text fallback.

Open Issues:
- `Click Selection Sometimes Does Not Register` remains open in `docs/BUGS.md`.
- Hover previews and hover-driven relationship apparition remain disabled.
- Relationship trace geometry is currently a straight-line baseline.

Next Task:
- Visually evaluate moving cut-line clarity, semantic-layer pacing, and
  compressed emphasis in the running app, then continue the existing node
  click reliability investigation.

Git State:
- The Markdown relocation and context workflow update are intentional changes.
- Backend/frontend semantic compression source changes are intentional changes.
- `README_showcase.md` and the existing `docs/demo.gif` remain separate
  showcase material.
