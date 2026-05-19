---
name: heuristic-intake
description: Draft compact Noesis learning-event artifacts from durable task residue. Use when a user asks to learn/promote/gate a behavior, when finishing a task with reusable corrections or failures, or when deciding whether a signal should enter the Noesis intake flow. This skill drafts events only; it does not write memory/wiki/skill changes or generate promote requests.
---

# Heuristic Intake

Use this skill to decide whether an interaction produced durable learning
residue and, when it did, draft a Noesis learning-event artifact.

This skill is an intake entry point. It is not a memory writer, wiki stager,
skill installer, eval mutator, or promote-request generator.

## Workflow

1. Identify candidate residue from the task, user correction, failure, repeated
   workflow, missing capability, tool behavior, or source-backed insight.
2. Apply `references/durability-rules.md`.
3. If no candidate is durable, say no event is needed.
4. If a candidate is durable, draft a compact event using
   `references/event-template.json`.
5. Include short source references only. Do not include full transcripts, raw
   logs, screenshots, private paths, credentials, customer data, or internal
   sensitive detail.
6. Run or ask to run:

   ```bash
   noesis event check <event-file> --json
   ```

7. Stop at the checked event. Routing to promote-request belongs to the next
   Noesis bridge step.

## Default Decision

Do not create events for ordinary task progress. Create an event only when the
signal is likely to improve future agent behavior or route to a maintained
owner artifact.

When uncertain, prefer a warning-level event with `confidence: "low"` and
`routing_hints` set to `unknown`, rather than promoting directly.

## Boundaries

This skill must not:

- write pamem memory;
- stage or promote LoreForge content;
- install, enable, remove, or update skills;
- write eval files;
- generate promote-request or proposal artifacts;
- retain full transcripts, raw chat logs, raw runtime logs, or private data.

## References

- `references/durability-rules.md`
- `references/event-template.json`
