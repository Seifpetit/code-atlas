# Decision Recorder Skill

This skill keeps `docs/DECISIONS.md` useful as the durable record of product, UX, and architecture decisions.

It is not responsible for making decisions. It records decisions that have already been made.

## Purpose

Maintain a clear decision archive for:
- product direction
- interaction model choices
- UI behavior rules
- architecture boundaries
- implementation constraints that affect future work

The goal is to preserve context so future work does not reopen settled questions accidentally.

## Primary Files

Read:
- `docs/DECISIONS.md`
- `docs/VOCABULARY.md`
- `docs/BUGS.md`
- relevant source files when needed
- relevant conversation notes when provided

Write:
- `docs/DECISIONS.md`

Do not write unresolved ideas as decisions. Put unresolved items in an "Open Questions" section only if they are directly tied to a recorded decision.

## When To Use

Use this skill after:
- the user explicitly says a decision has been made
- an implementation encodes a significant product or architecture choice
- a previous direction is reversed or deprecated
- a naming or interaction rule becomes official
- a design constraint needs to persist across future sessions

Do not use it for:
- temporary experiments
- minor implementation details
- bugs
- brainstorming that has not been accepted

## Init Case

Use this when `docs/DECISIONS.md` does not exist, is empty, or is clearly stale.

Steps:
1. Read `docs/VOCABULARY.md` and `docs/BUGS.md` if they exist.
2. Inspect the current UI and architecture files only as needed.
3. Identify decisions already reflected in the product.
4. Create numbered decision entries.
5. Keep entries short, specific, and durable.

Init output should include:
- decision title
- decision statement
- rationale
- status
- date if known

## Ongoing Update Flow

Steps:
1. Read the current `docs/DECISIONS.md`.
2. Identify whether the new information is a decision, reversal, clarification, or open question.
3. Update an existing decision if the concept already exists.
4. Add a new decision only for a distinct durable choice.
5. If a decision is superseded, mark it as superseded instead of deleting it.
6. Keep decision numbers stable when possible.

## Decision Entry Format

Use this format:

```md
## N. Decision Title

Status:
- Accepted

Decision:
- The durable choice.

Rationale:
- Why this choice exists.

Implications:
- What future work should respect.
```

Optional fields:
- `Date`
- `Supersedes`
- `Superseded by`

## Status Values

Use:
- `Accepted`
- `Superseded`
- `Deprecated`
- `Open`

Prefer `Accepted` for normal recorded decisions.

Use `Open` only when the file needs to preserve an unresolved decision boundary.

## Boundaries

This skill may:
- clarify wording
- organize decision entries
- add implications from accepted decisions
- link vocabulary terms to decisions

This skill must not:
- invent product strategy
- decide between unresolved options
- convert a bug into a decision
- rewrite history to hide reversals

## Output Standard

After updating decisions, report:
- decisions added
- decisions changed
- decisions superseded or deprecated
- open questions added

Keep the report short.
