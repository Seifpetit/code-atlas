# Bug Reporter Skill

This skill keeps `BUGS.md` useful as the durable record of known bugs, regressions, and UX issues.

It is not responsible for fixing bugs unless explicitly asked. It records and organizes known issues so they can be fixed later.

## Purpose

Maintain a clear bug archive for:
- UI bugs
- interaction bugs
- rendering issues
- confusing behavior
- regressions
- known technical risks that affect users

The goal is to make known problems easy to find, reproduce, prioritize, and eventually close.

## Primary Files

Read:
- `BUGS.md`
- `DECISIONS.md`
- `VOCABULARY.md`
- relevant source files when needed
- relevant user reports when provided

Write:
- `BUGS.md`

Do not write product decisions into `BUGS.md`. If a bug reveals a decision gap, mention the gap and point to `DECISIONS.md`.

## When To Use

Use this skill when:
- the user reports a bug
- a behavior is known to be broken
- an attempted fix fails or creates a regression
- a feature is removed because it is unstable
- a test or build reveals a user-facing issue
- a confusing interaction needs future investigation

Do not use it for:
- planned features
- accepted product decisions
- pure refactor notes
- speculative risks without observed behavior

## Init Case

Use this when `BUGS.md` does not exist, is empty, or is clearly stale.

Steps:
1. Read `DECISIONS.md` and `VOCABULARY.md` if they exist.
2. Inspect relevant source files only when needed.
3. Extract known issues from current notes or user reports.
4. Create entries with reproduction, expected behavior, actual behavior, and status.
5. Keep the archive focused on actionable issues.

## Ongoing Update Flow

Steps:
1. Read the current `BUGS.md`.
2. Determine whether the report is new, duplicate, fixed, or a regression.
3. Update an existing bug if it describes the same issue.
4. Add a new bug only when it is distinct and actionable.
5. Mark fixed bugs as fixed instead of deleting them.
6. If a bug leads to a removed feature, record that clearly.

## Bug Entry Format

Use this format:

```md
## Bug Title

Status:
- Open

Severity:
- Low | Medium | High

Area:
- UI area or component name

Observed:
- What actually happens.

Expected:
- What should happen.

Reproduction:
- Step-by-step if known.

Notes:
- Cause, suspected cause, or follow-up constraints.
```

Optional fields:
- `Date`
- `Regression`
- `Fixed in`
- `Related decision`

## Status Values

Use:
- `Open`
- `Investigating`
- `Blocked`
- `Fixed`
- `Won't Fix`

Prefer `Open` for newly reported bugs.

## Severity Guidance

Use:
- `High`: blocks core navigation, crashes, data loss, or makes the product unusable.
- `Medium`: confusing or broken behavior in an important workflow.
- `Low`: visual polish, edge cases, or minor friction.

## Boundaries

This skill may:
- organize bugs
- merge duplicates
- record failed fixes
- mark fixed bugs when a fix is confirmed
- reference decisions or vocabulary terms

This skill must not:
- invent unobserved bugs
- turn product disagreements into bugs
- remove bug history without a reason
- claim a bug is fixed without verification or a clear user/developer statement

## Output Standard

After updating bugs, report:
- bugs added
- bugs changed
- bugs marked fixed or reopened
- duplicates merged
- unresolved reproduction gaps

Keep the report short.
