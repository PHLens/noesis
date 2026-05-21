# Noesis

Noesis coordinates reviewable heuristic updates for agents.

It records routing decisions, proposal state, and checks for changes that belong
to memory, wiki knowledge, skills, or evals. Storage and application remain with
the owning subsystem.

## System Position

```text
Noesis System = reviewable heuristic update workflow

pamem         = memory layer: preferences, workflow rules, corrections, meta-knowledge
LoreForge     = knowledge layer: source-backed notes, cards, MOCs, domain knowledge
skills        = capability layer: executable procedures and reusable agent behavior
evals         = regression layer: routing, workflow, and skill quality gates
Noesis        = control plane: detect, route, propose, review, evaluate, compress
skill-manager = capability lifecycle tool used by Noesis after approval
```

Related repositories:

- [pamem](https://github.com/PHLens/pamem)
- [LoreForge](https://github.com/PHLens/LoreForge)

Noesis records and evaluates decisions about heuristic updates.

## Core Responsibilities

Noesis owns:

- learning event capture: durable signals from tasks, feedback, failures, and repeated workflows
- routing decisions for memory, knowledge, skills, evals, compression, or discard
- promote-request and proposal routing vocabulary
- proposal lifecycle for reviewable memory/wiki/skill/eval changes
- learning-loop quality gates
- coordination policy for automation boundaries and required review

Noesis may coordinate:

- `pamem` memory requests
- `LoreForge` wiki ingest/stage packages
- skill proposals and approved skill-manager actions
- eval case proposals
- compression proposals for stale or repetitive learning artifacts

Out of scope for Noesis:

- stable pamem memory writes
- direct LoreForge wiki staging or promotion
- skill installation, enabling, or update without approval
- memory repo or wiki structure ownership
- full transcript retention by default
- bypass review for high-impact behavior changes

## Current Implementation

Implemented:

- `package.json`: npm package metadata for `@phlens/noesis`
- `bin/noesis`: Node CLI entrypoint
- `noesis init`, `noesis doctor`, and `noesis config show` for conservative Noesis-owned bootstrap state
- `noesis event check` for read-only learning-event intake validation
- `noesis event promote` for event-to-promote-request bridge artifacts
- `noesis promote check` and `noesis promote plan` for checked, proposal-only promote flow
- `noesis proposal list`, `noesis proposal summary`, `noesis proposal show`, and `noesis proposal update` for proposal queue review metadata
- `noesis eval handoff` for approved eval-proposal owner handoff reports
- `lib/skill-manager.mjs`: skill-manager CLI for symlink skill visibility and known capability lifecycle operations
- command-level help for `noesis`, `noesis skill`, and each skill subcommand
- plugin/runtime capability status and mutation for `humanize`, `superpowers`, and `pamem`
- managed skill sources for `code-review`, `doc-review`, `heuristic-intake`, `noesis-skill-manager`, and `shared-devflow`
- `skills/heuristic-intake/`: drafts compact learning-event artifacts from durable task residue
- `tests/skill_manager.test.mjs`: skill-manager CLI tests

Not yet implemented:

- skill proposal lifecycle
- learning review workflow
- compression loop

Owned by other systems:

- memory lint is owned by `pamem`
- wiki ingest mechanics are owned by `LoreForge`

## Learning Flow

```text
task / conversation
  -> Noesis captures learning events
  -> Noesis converts selected events into promote requests
  -> Noesis creates reviewable proposals
  -> pamem / LoreForge / skill-manager / eval tools apply approved changes
  -> Noesis records outcomes and regression signals
  -> repeated artifacts are compressed into stable memory, wiki cards, skills, or evals
```

The default automation boundary is proposal generation. Stable application stays
with the owning subsystem and requires review where configured.

## Entry Skill Workflow

Runtime use is entry-skill driven:

- `pamem` entry skill handles memory loading, memory governance, memory lint, and memory proposal handoffs.
- `LoreForge` entry skill handles wiki/source-backed knowledge staging and promotion.
- Noesis `heuristic-intake` drafts compact learning-event artifacts from durable task residue.
- Noesis `noesis-skill-manager` delegates skill visibility and capability lifecycle work to `noesis skill ...`.

When a user explicitly asks to promote or gate a repeated pattern, Noesis
creates local promote-request state, routes and gates it, and emits reviewable
proposal artifacts. Stable memory, wiki, and skill changes are applied by their
owning systems after approval.

See `docs/entry-skill-workflow.md`.

## Bootstrap Manifest

Noesis may create a local `.noesis/config.toml` manifest for component
orchestration. The manifest stores component pointers, required entry skills,
version constraints, and Noesis-owned local state paths. `.pamem/config.toml`
and `.loreforge/config.toml` remain authoritative for their systems.

See `docs/manifest-contract.md` and `examples/noesis-config.example.toml`.

## Install And CLI

Noesis is an npm package with a `noesis` bin:

```bash
npm install -g git+ssh://git@github.com/PHLens/noesis.git
noesis --help
noesis help skill add
```

From a local checkout, use:

```bash
npm install -g .
noesis --help
```

The first implemented command families are bootstrap and skill management:

```bash
noesis init [--workspace <path>] [--with pamem,loreforge|none] [--force] [--json]
noesis doctor [--workspace <path>] [--json]
noesis config show [--workspace <path>] [--json]
noesis event check .noesis/events/<id>.json [--json]
noesis event promote .noesis/events/<id>.json [--out .noesis/promote-requests] [--json]
noesis promote check .noesis/promote-requests/<id>.json [--json]
noesis promote plan .noesis/promote-requests/<id>.json [--out .noesis/proposals] [--json]
noesis proposal list [--workspace <path>] [--dir .noesis/proposals] [--json]
noesis proposal summary [--workspace <path>] [--dir .noesis/proposals] [--stale-days 7] [--json]
noesis proposal show <proposal-id-or-path> [--workspace <path>] [--json]
noesis proposal update <proposal-id-or-path> --status approved [--reviewer <name>] [--note <text>] [--json]
noesis eval handoff <proposal-id-or-path> [--workspace <path>] [--out .noesis/reports/eval-handoffs] [--json]
noesis skill list [--workspace <path>|--agent-id <id>|--global] [--json]
noesis skill inspect <name> [--source <path>] [--json]
noesis skill verify [name] [--json]
noesis skill add <name> [--source <path>] [--alias <alias>] [--runtime codex|claude|both] [--json]
noesis skill remove <name> [--runtime codex|claude|both] [--json]
```

The bootstrap commands are intentionally conservative:

- `init` creates `.noesis/config.toml` and Noesis-owned local state directories;
- `doctor` is read-only for Noesis-owned state, reports missing downstream readiness as warnings unless the manifest itself is invalid, and can consume JSON from declared `status_command` / `validate_command`;
- `config show` prints the raw or parsed manifest.

They create Noesis-owned bootstrap state only. pamem memory, LoreForge wiki
content and skill changes remain outside this command surface.
Generated manifests enable pamem by default. LoreForge is enabled when the
`loreforge` CLI is discoverable; otherwise it remains declared but disabled.

`noesis event check` is a read-only gate for a learning-event JSON artifact. It
validates schema, compact source references, case shape, impact metadata,
optional routing hints, and transcript-retention hazards. It does not route,
write promote requests, write proposal artifacts, apply owner changes, mutate
memory, stage wiki content, or change skills.

`noesis event promote` reruns the read-only event check and writes one
promote-request artifact under `.noesis/promote-requests/` or an explicit
`--out` directory. It maps routing hints into candidate items and requested
outputs, keeps `allow_apply=false`, and does not generate proposals or call
owner apply flows. See `docs/learning-event-schema.md` and
`examples/learning-event.example.json`.

`noesis promote check` is a read-only gate for a promote-request JSON artifact.
It validates schema, short source references, target surface, risk/review
boundaries, proposal-only policy, and transcript-retention hazards. It does not
write `.noesis/proposals/`, apply owner changes, mutate memory, stage wiki
content, or change skills. See `docs/promote-request-schema.md` and
`examples/promote-request.example.json`.

`noesis promote plan` reruns the read-only check and writes isolated proposal
JSON artifacts under `.noesis/proposals/` or an explicit `--out` directory. It
does not apply owner changes, mutate memory, stage wiki content, or change
skills. Existing proposal artifacts are not overwritten unless `--force` is
provided.

`noesis proposal list`, `noesis proposal summary`, and `noesis proposal show`
inspect the local proposal queue. `summary` aggregates pending, stale,
high-risk, invalid, and owner-handoff warning conditions without writing state.
`noesis proposal update` records review metadata on one proposal artifact with
statuses such as `approved`, `rejected`, or `superseded`. It writes only the
proposal JSON file and preserves `outcome.status=not_applied`; owner apply flows
remain outside Noesis. See `docs/proposal-queue.md`.

`noesis eval handoff` consumes an approved `eval_proposal` and writes a
Noesis-owned handoff report under `.noesis/reports/eval-handoffs/`. It does not
create eval files, run evals, update proposals, or apply owner changes. See
`docs/eval-handoff.md`.

The skill manager manages symlink-based skill visibility in both `.codex/skills/` and `.claude/skills/`. It resolves managed sources under this package's `skills/` first, keeps `~/skills` as an external compatibility source, creates relative symlinks, repairs mismatched symlinks, refuses non-symlink conflicts, and removes only visibility links.

The managed `noesis-skill-manager` skill is a thin runtime entrypoint that delegates skill and capability work to `noesis skill ...`; it does not duplicate the CLI implementation.

Target resolution supports the current directory, explicit `--workspace`, pamem `--agent-id` via `pamem status --agent-id <id> --json`, and explicit `--global`. For pamem agents, skill visibility is managed on the resolved `root`; the shared `memory_repo` is reported for context but is not used as a `.codex/skills` or `.claude/skills` target.

Known Claude plugin capabilities (`humanize`, `superpowers`) are enabled and disabled through the official Claude plugin CLI when available, with `.claude/settings.json` fallback for environments without `claude`. The `pamem` runtime capability can be enabled or removed for Claude plugin runtime, Codex bootstrap, or both with `--runtime`; Codex bootstrap delegates to the installed pamem CLI. `memory-lint` and `memory-rule` are provided by `pamem` and are not managed as standalone symlink skills.

`@phlens/pamem` is a package dependency so `--agent-id` can resolve through the installed pamem bin. If the dependency bin is unavailable, the CLI falls back to `pamem` on `PATH`.

## Key Files

- `package.json`: npm package and bin metadata
- `bin/noesis`: Node CLI entrypoint
- `lib/skill-manager.mjs`: symlink skill visibility manager
- `lib/event.mjs`: learning-event schema and read-only intake check
- `lib/promote.mjs`: promote-request schema, read-only gate checks, and proposal-only plan artifacts
- `lib/proposal.mjs`: proposal queue list/show/update review metadata CLI
- `lib/eval-handoff.mjs`: approved eval-proposal handoff report CLI
- `docs/architecture.md`: current system boundary
- `docs/entry-skill-workflow.md`: entry-skill and first promote/gate workflow
- `docs/learning-lifecycle.md`: proposed learning lifecycle
- `docs/learning-event-schema.md`: learning-event schema and intake check report
- `docs/manifest-contract.md`: `.noesis/config.toml` and component contract
- `docs/promote-request-schema.md`: promote-request schema and check report
- `docs/proposal-queue.md`: proposal queue status and review CLI contract
- `docs/eval-handoff.md`: approved eval-proposal handoff report contract
- `examples/noesis-config.example.toml`: example Noesis bootstrap manifest
- `examples/learning-event.example.json`: example learning-event artifact
- `examples/promote-request.example.json`: example promote-request artifact
- `findings.md`: accepted decisions and design findings
- `task_plan.md`: current work tracker
- `progress.md`: current progress and next steps
- `skills/noesis-skill-manager/SKILL.md`: thin runtime entrypoint for the skill-manager CLI
- `skills/heuristic-intake/SKILL.md`: intake entry skill for learning-event drafting
- `skills/heuristic-intake/references/durability-rules.md`: durability and routing-hint rules
- `skills/heuristic-intake/references/event-template.json`: learning-event draft template

## Tagline

Noesis: a control plane for reviewable agent heuristic updates.
