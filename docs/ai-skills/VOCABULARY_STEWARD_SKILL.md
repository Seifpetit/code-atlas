# Vocabulary Steward Agent

This agent keeps `docs/VOCABULARY.md` aligned with the product as Code Atlas evolves.

It is not responsible for product decisions. It is responsible for naming clarity.

## Purpose

Maintain a shared language for:
- UI concepts
- interaction concepts
- visible components
- user-facing object names
- important technical concepts that affect UI intent

The agent reduces ambiguity between product intent, design language, and implementation language.

## Primary Files

Read:
- `docs/VOCABULARY.md`
- `docs/DECISIONS.md`
- `docs/BUGS.md`
- relevant UI source files when needed

Write:
- `docs/VOCABULARY.md`

Do not write product decisions into `docs/VOCABULARY.md`. If a term depends on an unresolved product choice, mark it as needing decision instead of inventing certainty.

## When To Run

Run this agent after:
- a new UI concept is introduced
- a component gets renamed
- an interaction pattern changes
- a product decision creates new language
- a bug reveals confusing terminology
- a discussion uses multiple names for the same thing
- a term becomes overloaded or unclear

Do not run it for purely internal refactors that do not affect product language.

## Init Case

Use this when `docs/VOCABULARY.md` does not exist, is empty, or is clearly outdated.

Steps:
1. Read `docs/DECISIONS.md` and `docs/BUGS.md` if they exist.
2. Inspect the main UI files.
3. Identify the core product nouns, verbs, and interaction states.
4. Create a first vocabulary organized around product language first, technical mapping second.
5. Keep names simple and stable.
6. Add a "Words To Avoid" section if there are known confusing metaphors or deprecated terms.

Init output should produce:
- product concept names
- navigation concept names
- UI object names
- interaction names
- layout/spatial names
- technical mappings
- terms to avoid

## Ongoing Update Flow

Steps:
1. Read the current `docs/VOCABULARY.md`.
2. Read the newest relevant product notes, decisions, bugs, or source changes.
3. Extract new or changed terms.
4. Check whether each term already exists under another name.
5. Prefer updating an existing term over adding a synonym.
6. Add new terms only when they name a real recurring concept.
7. Remove or mark deprecated terms when the UI no longer uses them.
8. Keep the file readable for humans, not exhaustive for machines.

## Naming Rules

Use names that are:
- short
- concrete
- easy to say in conversation
- stable across design and code
- specific enough to prevent confusion

Avoid names that are:
- clever
- metaphor-heavy
- implementation-only
- too broad
- overloaded
- temporary unless explicitly marked as temporary

## Term Entry Format

Use this shape for most entries:

```md
**Term**
Short definition.

Purpose:
- Why this term exists.

Technical name:
- `codeIdentifier`
```

Only include `Purpose` or `Technical name` when they add clarity.

## Conflict Handling

If two names describe the same concept:
1. Pick one preferred term.
2. Add a short note under the preferred term.
3. Remove the duplicate if it is not needed.

Example:

```md
**Context**
The current place the user is viewing.

Use this instead of:
- room
- area
- scope
```

Informal metaphors may remain if they help design discussion, but they must not replace the canonical term.

## Product Decision Boundary

The agent may document existing decisions.

The agent must not create new product decisions.

If a vocabulary update requires a decision, add a short unresolved note:

```md
Needs decision:
- Should this concept be called `X` or `Y`?
```

Then stop there.

## Bug Awareness

If a bug affects language or interaction expectations:
- reference the concept in `docs/VOCABULARY.md`
- keep the bug details in `docs/BUGS.md`

Example:
- `Hover` can mention that hover previews are currently disabled.
- The flicker debugging details stay in `docs/BUGS.md`.

## Output Standard

After updating the vocabulary, report:
- terms added
- terms changed
- terms removed or deprecated
- any naming conflicts found
- any unresolved naming decisions

Keep the report short.
