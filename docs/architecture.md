# Noesis Architecture

Noesis is the control plane for reviewable heuristic updates.

The system changes behavior through memory, wiki knowledge, skills, evals,
proposals, and reviewable updates.

## System Boundary

```text
interaction / task
  -> learning event capture
  -> Noesis routing and proposal generation
  -> review and eval gates
  -> approved downstream execution
  -> outcome recording and compression
```

Noesis records routing and proposal decisions. Downstream systems execute their
own changes.

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

The `noesis-skill-manager` managed skill is the runtime-facing entrypoint for this module. It stays thin and delegates behavior to the `noesis skill` CLI.

`Noesis` owns learning control:

- recognizing learning events
- routing events to memory, wiki, skill, eval, compression, or discard
- creating reviewable proposals
- coordinating review and eval gates
- managing Noesis-owned local control-plane state under `.noesis/`
- recording rationale, provenance, and outcome
- enforcing review boundaries for behavior changes

## Bootstrap Contract

Noesis may own a local bootstrap manifest:

```text
.noesis/config.toml
```

The manifest records component pointers and Noesis-owned local state paths.
Owner configs remain authoritative:

```text
.pamem/config.toml
.loreforge/config.toml
```

The detailed manifest and component contract is in
`docs/manifest-contract.md`.

## Learning Artifacts

Noesis should eventually manage these artifact families:

- `learning-event`: a signal that something may be worth learning
- `promote-request`: explicit local request to route and gate candidate learning residue
- `memory-proposal`: request for pamem-owned memory update
- `wiki-proposal`: request for LoreForge-owned wiki staging
- `skill-proposal`: request to create or update a skill
- `eval-proposal`: request to add a regression or golden case
- `compression-proposal`: request to consolidate repeated or stale artifacts

The current implementation covers learning-event intake, promote-request checks,
proposal-only planning, proposal queue review, and the heuristic-intake skill.

The first promote/gate design slice is documented in
`docs/entry-skill-workflow.md`. Entry skills stay thin: pamem handles memory,
LoreForge handles wiki knowledge, Noesis routes and gates candidate learning
residue, and skill-manager executes approved capability changes.

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

Disallowed by default:

- unreviewed core behavior changes
- hidden transcript retention
- direct memory/wiki writes from Noesis
- memory executor behavior inside Noesis

## Skill Manager Position

Skill manager is the Noesis capability lifecycle module.

Noesis decides when a repeated workflow or failure pattern deserves a skill
proposal. Skill manager executes approved capability lifecycle operations.

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

The CLI also supports command-specific help:

```bash
noesis --help
noesis help skill
noesis skill add --help
```

Supported target resolution:

- current working directory by default
- explicit `--workspace <path>`
- pamem agent home or workspace via `--agent-id <id>` and `pamem status --agent-id <id> --json`
- explicit global scope via `--global`

`@phlens/pamem` is an npm dependency of `@phlens/noesis` for this `--agent-id` resolution path. The CLI prefers the installed dependency bin and falls back to `pamem` on `PATH`. Skill visibility is managed on the resolved pamem `root`; shared `memory_repo` is contextual metadata and is not a skill target.

Supported source resolution:

- managed package source under `skills/`, searched first
- external compatibility source under `~/skills`
- explicit `--source <path>` under either supported root

Supported capability operations:

- symlink skills: `list`, `inspect`, `verify`, `add`, and `remove`
- Claude plugin capabilities: `humanize`, `superpowers`
- runtime capability: `pamem`

Claude plugin capabilities are enabled and disabled through the official Claude plugin CLI when available, with `.claude/settings.json` fallback for environments without `claude`. `pamem` runtime mutation supports `--runtime claude`, `--runtime codex`, or `--runtime both`; Claude runtime uses the same plugin flow, and Codex bootstrap/removal delegates to the installed `pamem` CLI. `memory-lint` and `memory-rule` stay owned by `pamem` and are rejected as standalone symlink skills.

Future skill-manager work should add approved skill proposal application while
memory governance remains in pamem.

## Out Of Scope

- memory storage
- wiki content ownership
- pamem memory governance
- LoreForge wiki mechanics
- skill changes without approval
- full transcript retention by default

## Name

Keep the name `Noesis`.

The name identifies the control layer that classifies candidate learning
signals and routes them to the right owner with enough evidence to review.
