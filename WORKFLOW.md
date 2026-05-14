# Production Workflow

This workflow keeps Code Atlas moving without relying only on memory or discipline.

The goal is not to document everything. The goal is to preserve the product intent that future work depends on.

## Daily Loop

1. Build or investigate normally.
2. Keep implementation momentum during the work.
3. When a concept, decision, or bug becomes durable, archive it.
4. At the end of a meaningful session, run an archive pass.

Use this prompt:

```text
Run an archive pass using ai-prompts/archive-pass.md.
```

## Archive Pass

An archive pass checks whether recent work should update:

- `VOCABULARY.md`
- `DECISIONS.md`
- `BUGS.md`

The archive pass uses these skill specs:

- `ai-skills/VOCABULARY_STEWARD_SKILL.md`
- `ai-skills/DECISION_RECORDER_SKILL.md`
- `ai-skills/BUG_REPORTER_SKILL.md`

## When To Archive

Archive when any of these happen:

- A UI concept gets a stable name.
- A component or interaction is renamed.
- A product or architecture decision is accepted.
- A previous decision is reversed or deprecated.
- A bug is found, fixed, deferred, or causes a feature to be removed.
- A repeated phrase appears in discussion and needs a canonical name.
- A future contributor would need context to avoid repeating the same debate.

Do not archive every tiny implementation detail.

## Before Starting Bigger Work

Before a major UI or architecture change, read:

- `VOCABULARY.md`
- `DECISIONS.md`
- `BUGS.md`

Then use the relevant skill spec from `ai-skills/` if the change touches shared language, decisions, or bugs.

## End-Of-Session Checklist

Ask:

- Did we name a new thing?
- Did we change how users interact with the atlas?
- Did we accept or reverse a product decision?
- Did we find, fix, or defer a bug?
- Did we remove a feature because it was unstable?
- Would tomorrow's session need context from today?

If yes to any of these, run an archive pass.

## CI Reminder

The archive check is intentionally a warning, not a blocker.

It warns when source files changed without updates to:

- `VOCABULARY.md`
- `DECISIONS.md`
- `BUGS.md`
- `ai-skills/`
- `WORKFLOW.md`

Run locally:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/archive-pass-check.ps1
```

The GitHub Actions workflow lives at:

```text
.github/workflows/archive-check.yml
```
