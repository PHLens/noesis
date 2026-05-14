# Noesis

Noesis is the learning control plane for an agent heuristic system.

It does not store memory, own a wiki, or directly install capabilities. It coordinates how an agent turns feedback and task residue into auditable learning artifacts that can be reviewed, tested, and handed off to the right subsystem.

## System Position

```text
Noesis System = heuristic system for agent self-improvement

pamem         = memory layer: preferences, workflow rules, corrections, meta-knowledge
LoreForge     = knowledge layer: source-backed notes, cards, MOCs, domain knowledge
skills        = capability layer: executable procedures and reusable agent behavior
evals         = regression layer: routing, workflow, and skill quality gates
Noesis        = control plane: detect, route, propose, review, evaluate, compress
skill-manager = capability lifecycle tool used by Noesis after approval
```

Noesis is not a third storage system. It records and evaluates learning decisions.

## Core Responsibilities

Noesis owns:

- learning event capture: durable signals from tasks, feedback, failures, and repeated workflows
- routing decisions for memory, knowledge, skills, evals, compression, or discard
- writeback intent schema and routing vocabulary
- proposal lifecycle for reviewable memory/wiki/skill/eval changes
- routing evals and future learning-loop quality gates
- coordination policy: what may be automatic, what requires review, and what is forbidden

Noesis may coordinate:

- `pamem` memory requests
- `LoreForge` wiki ingest/stage packages
- skill proposals and approved skill-manager actions
- eval case proposals
- compression proposals for stale or repetitive learning artifacts

Noesis must not:

- write stable pamem memory directly
- stage or promote LoreForge wiki notes directly
- install, enable, or update skills without approval
- own memory repo structure or wiki structure
- run private sync backends
- save full transcripts by default
- bypass review for high-impact behavior changes

## Current Implementation

Implemented:

- `skills/writeback-router/`: classifies durable residue and emits writeback intent
- `examples/writeback-intent.example.json`: example intent artifact
- `evals/writeback-routing.jsonl`: golden routing cases
- `evals/run-writeback-routing-evals.py`: routing eval runner
- `tests/routing_eval/`: routing eval tests

Not yet implemented:

- learning event schema
- proposal queue
- skill proposal lifecycle
- learning review workflow
- compression loop
- skill-manager integration
- unified CLI

Removed from active Noesis scope:

- memory lint is owned by `pamem`
- wiki ingest mechanics are owned by `LoreForge`

## Learning Flow

```text
task / conversation
  -> Noesis captures learning events
  -> Noesis routes each event
  -> Noesis creates reviewable proposals
  -> pamem / LoreForge / skill-manager / eval tools apply approved changes
  -> Noesis records outcomes and regression signals
  -> repeated artifacts are compressed into stable memory, wiki cards, skills, or evals
```

The safe default is autonomous proposal, not autonomous application.

## Key Files

- `docs/architecture.md`: current system boundary
- `docs/learning-lifecycle.md`: proposed learning lifecycle
- `findings.md`: accepted decisions and design findings
- `task_plan.md`: current work tracker
- `progress.md`: current progress and next steps
- `skills/writeback-router/SKILL.md`: current writeback-router skill
- `skills/writeback-router/references/intent-schema.md`: writeback intent schema reference
- `skills/writeback-router/references/routing-rules.md`: routing and review policy reference
- `examples/writeback-intent.example.json`: example writeback intent artifact
- `evals/writeback-routing.jsonl`: routing eval cases
- `evals/run-writeback-routing-evals.py`: routing eval runner

## Tagline

Noesis: a learning control plane for auditable agent self-improvement.
