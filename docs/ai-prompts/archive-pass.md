# Archive Pass Prompt

Run an archive pass for Code Atlas.

## Goal

Update archive docs only where recent work changed durable product intent, shared language, decisions, or known bugs.

Do not rewrite the archive files unnecessarily.

## Read First

Read:

- `docs/WORKFLOW.md`
- `docs/VOCABULARY.md`
- `docs/DECISIONS.md`
- `docs/BUGS.md`
- `docs/ai-skills/VOCABULARY_STEWARD_SKILL.md`
- `docs/ai-skills/DECISION_RECORDER_SKILL.md`
- `docs/ai-skills/BUG_REPORTER_SKILL.md`

If source changes are relevant, inspect the affected files.

## Tasks

1. Use the Vocabulary Steward Skill if shared language changed.
2. Use the Decision Recorder Skill if a durable product, UX, or architecture choice was made.
3. Use the Bug Reporter Skill if a bug was found, fixed, deferred, removed, or reopened.
4. Keep updates short and specific.
5. Do not invent decisions or bugs.
6. If nothing needs archiving, say that clearly.

## Output

Report:

- archive files changed
- terms added or changed
- decisions added or changed
- bugs added, changed, fixed, or reopened
- unresolved archive gaps

Keep the report concise.
