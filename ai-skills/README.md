# AI Skills

This folder contains reusable LLM skill specs for maintaining product memory.

These files are not autonomous agents. They are operating instructions that a coding assistant or LLM can read and follow when asked.

## Skill Loader Convention

When a user asks to use a skill:

1. Open the relevant skill file in `ai-skills/`.
2. Read its purpose, scope, and output standard.
3. Read the primary files listed by the skill.
4. Make only the archive updates that the skill allows.
5. Report what changed and what remains unresolved.

## Available Skills

- `VOCABULARY_STEWARD_SKILL.md`: keeps `VOCABULARY.md` aligned with UI and product language.
- `DECISION_RECORDER_SKILL.md`: keeps `DECISIONS.md` aligned with accepted product, UX, and architecture decisions.
- `BUG_REPORTER_SKILL.md`: keeps `BUGS.md` aligned with known issues and fixes.

## Prompt Command

Use this prompt for a full archive pass:

```text
Run an archive pass using ai-prompts/archive-pass.md.
```

That prompt decides which skills are relevant and updates only the necessary archive files.

## Boundaries

Skills may document accepted context.

Skills must not:

- invent product decisions
- invent unobserved bugs
- rename concepts without a reason
- turn brainstorming into durable archive entries
- update unrelated files
