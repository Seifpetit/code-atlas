# Close Session Prompt

Close the current Code Atlas production session.

## Goal

End the session with verified work, archived context, and a clear handoff.

This is broader than an archive pass. An archive pass preserves product memory. A close session pass also checks verification, git state, and next work.

## Read First

Read:

- `WORKFLOW.md`
- `SESSION_NOTES.md`
- `VOCABULARY.md`
- `DECISIONS.md`
- `BUGS.md`
- recent `git status --short`

If source changed, inspect the relevant source files or recent diff summary.

## Tasks

1. Run or report the relevant verification command.
2. Run an archive pass if durable product intent, language, decisions, or bugs changed.
3. Update `SESSION_NOTES.md` with:
   - completed work
   - verification status
   - archive updates
   - open issues
   - next likely task
   - git status summary
4. Run `scripts/close-session-check.ps1`.
5. Commit and push only if explicitly requested.

## Output

Report:

- completed work
- verification result
- archive files changed
- session notes update
- git status
- open loops

Keep the report concise.
