# Close Session Prompt

Close the current Code Atlas production session.

## Goal

End the session with verified work, archived context, and a clear handoff.

This is broader than an archive pass. An archive pass preserves product memory. A close session pass also checks verification, git state, and next work.

## Read First

Read:

- `CONTEXT.md`
- `docs/WORKFLOW.md`
- `docs/SESSION_NOTES.md`
- `docs/VOCABULARY.md`
- `docs/DECISIONS.md`
- `docs/BUGS.md`
- recent `git status --short`

If source changed, inspect the relevant source files or recent diff summary.

## Tasks

1. Run or report the relevant verification command.
2. Run an archive pass if durable product intent, language, decisions, or bugs changed.
3. Update `docs/SESSION_NOTES.md` with:
   - completed work
   - verification status
   - archive updates
   - open issues
   - next likely task
   - git status summary
4. Refresh the `Current Handoff` in `CONTEXT.md` from `docs/SESSION_NOTES.md` and
   the relevant archive updates so the next session can resume from one summary.
5. Run `scripts/close-session-check.ps1`.
6. Commit and push only if explicitly requested.

## Output

Report:

- completed work
- verification result
- archive files changed
- session notes and context handoff update
- git status
- open loops

Keep the report concise.
