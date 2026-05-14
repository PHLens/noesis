# Noesis Architecture

Noesis is the control plane of a heuristic system.

The system improves outside model weights: through memory, wiki knowledge, skills, evals, proposals, and reviewable updates.

## System Boundary

```text
interaction / task
  -> learning event capture
  -> Noesis routing and proposal generation
  -> review and eval gates
  -> approved downstream execution
  -> outcome recording and compression
```

Noesis decides and records. Downstream systems execute their own changes.

## Module Ownership

`pamem` owns memory:

- memory repo configuration
- `MEMORY.md` and `notes/` semantics
- memory lint
- memory request and promotion flow
- stable memory cleanup
- cross-runtime memory governance

`LoreForge` owns wiki knowledge:

- wiki directory structure
- ingest and staging
- promote workflow
- wiki lint
- cards, sources, MOCs, indexes, and archives
- Obsidian adapter behavior

`skill-manager` owns capability lifecycle operations:

- list and inspect skills
- validate skill structure
- install, uninstall, enable, or disable skills
- apply approved skill proposals
- report current capability inventory

The current CLI slice is the npm `noesis` bin and manages symlink-based skills exposed through `.codex/skills/` and `.claude/skills/`. Managed sources live under this package's `skills/`; `~/skills` remains an external compatibility source.

`Noesis` owns learning control:

- recognizing learning events
- routing events to memory, wiki, skill, eval, compression, or discard
- creating reviewable proposals
- coordinating review and eval gates
- recording rationale, provenance, and outcome
- keeping the system from learning unsafe or unreviewed behavior

## Learning Artifacts

Noesis should eventually manage these artifact families:

- `learning-event`: a signal that something may be worth learning
- `writeback-intent`: current routing artifact for pamem/LoreForge destinations
- `memory-proposal`: request for pamem-owned memory update
- `wiki-proposal`: request for LoreForge-owned wiki staging
- `skill-proposal`: request to create or update a skill
- `eval-proposal`: request to add a regression or golden case
- `compression-proposal`: request to consolidate repeated or stale artifacts

The current implementation only covers `writeback-intent` and routing evals.

## Review And Automation Policy

Safe by default:

- capture learning events
- classify and route events
- generate proposals
- run read-only evals and lint checks
- draft skill changes in isolated proposal locations

Requires review:

- stable pamem writes
- LoreForge promotion
- skill install, enable, update, or removal
- high-impact workflow rule changes
- changes that supersede existing behavior

Forbidden by default:

- unreviewed core behavior mutation
- hidden transcript retention
- direct memory/wiki writes from Noesis
- sync executor behavior inside Noesis

## Skill Manager Position

Skill manager belongs inside the Noesis system as a capability lifecycle module, not as a separate long-term system.

It is not the learning brain. Noesis decides when a repeated workflow or failure pattern deserves a skill proposal. Skill manager only executes approved capability lifecycle operations.

```text
Noesis detects repeated workflow
  -> creates skill proposal
  -> drafts skill artifact and tests
  -> review approves
  -> skill-manager validates and applies
  -> Noesis records outcome
```

Initial implemented commands:

```bash
noesis skill list
noesis skill inspect <name>
noesis skill verify [name]
noesis skill add <name>
noesis skill remove <name>
```

Supported target resolution:

- current working directory by default
- explicit `--workspace <path>`
- pamem agent home via `--agent-id <id>` and `pamem status --agent-id <id> --json`
- explicit global scope via `--global`

`@phlens/pamem` is an npm dependency of `@phlens/noesis` for this `--agent-id` resolution path. The CLI prefers the installed dependency bin and falls back to `pamem` on `PATH`.

Supported source resolution:

- managed package source under `skills/`, searched first
- external compatibility source under `~/skills`
- explicit `--source <path>` under either supported root

Future skill-manager work should add plugin capability support, runtime capability support, and approved skill proposal application without moving memory governance into Noesis.

## Non-Goals

Noesis must not:

- become a memory store
- become a wiki engine
- absorb pamem memory governance
- absorb LoreForge wiki mechanics
- make skill changes without approval
- run private sync backends
- save full transcripts by default

## Name

Keep the name `Noesis`.

The name fits the control layer because the hard part is judgment: recognizing what matters, deciding what kind of learning it represents, and sending it to the right owner with enough evidence to review.
