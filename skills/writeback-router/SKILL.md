---
name: writeback-router
description: Classify durable residue from agent interactions into pamem memory, LoreForge wiki staging, split, or discard decisions. This is the first concrete slice of Noesis learning control; use it to produce a writeback intent artifact without executing persistent writes.
---

# Writeback Router

Classify candidate durable residue from an agent interaction and produce a structured writeback intent artifact.

This is the first concrete slice of Noesis' learning control plane. It records routing judgment between `pamem` and `LoreForge`; it does not perform either system's writes.

## Hard Boundary

This module is a classifier and decision recorder.

It must not:

- write to pamem notes
- stage or promote LoreForge wiki notes
- install, enable, disable, or update skills
- run sync
- run lint or eval
- save full transcripts
- mutate pamem, LoreForge, wiki, or workspace configuration

It may:

- classify candidate items
- recommend destinations
- recommend follow-up actions
- create or update a writeback intent artifact when the user or active workflow asks for artifact output

## When To Use

Use this skill:

- at task completion when the task produced possible durable residue
- immediately after a clear low-risk meta discovery
- when reviewing a summary of candidate items for persistence

Do not use this skill for every ordinary dialogue turn.

## Inputs

Default input:

- `candidate_items`: agent-selected items that may deserve durable treatment

Optional input:

- `task_summary`: short task or interaction context
- `source_refs`: source references such as files, notes, URLs, or conversation pointers

Avoid full transcripts by default.

## Output

Produce a batch writeback intent.

Recommended artifact path:

```text
.writeback/intents/YYYY-MM-DDTHH-MM-SSZ__writeback.json
```

Use `references/intent-schema.md` as the schema authority.

## Workflow

1. Read the task summary and candidate items.
2. Reject items that are obviously transient.
3. Classify each durable item as `meta`, `domain`, `mixed`, or `transient`.
4. Route each item to `pamem-experience`, `wiki-stage`, `split`, or `none`.
5. Assign `confidence`.
6. Set `review_required` using `references/routing-rules.md`.
7. Set `suggested_action`.
8. Write a short `reason` for the route.
9. Emit a batch intent artifact if artifact output is requested.

## Routing Summary

| Category | Destination | Typical Action |
|---|---|---|
| `meta` | `pamem-experience` | `append-experience` |
| `domain` | `wiki-stage` | `stage-wiki-note` via LoreForge |
| `mixed` | `split` | `split-item` |
| `transient` | `none` | `discard` |

## Review Summary

Low-risk meta may be marked `review_required: false`.

All of the following require review:

- user preference
- rule or workflow change
- item that supersedes old experience
- domain/wiki content
- `mixed/split` item
- low-confidence item
- any item that significantly changes long-term agent behavior

## References

- `references/intent-schema.md`
- `references/routing-rules.md`
