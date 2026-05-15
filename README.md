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

- `package.json`: npm package metadata for `@phlens/noesis`
- `bin/noesis`: Node CLI entrypoint
- `lib/skill-manager.mjs`: skill-manager CLI for symlink skill visibility and known capability lifecycle operations
- command-level help for `noesis`, `noesis skill`, and each skill subcommand
- plugin/runtime capability status and mutation for `humanize`, `superpowers`, and `pamem`
- managed skill sources for `code-review`, `doc-review`, `noesis-skill-manager`, `shared-devflow`, and `writeback-router`
- `skills/writeback-router/`: classifies durable residue and emits writeback intent
- `examples/writeback-intent.example.json`: example intent artifact
- `evals/writeback-routing.jsonl`: golden routing cases
- `evals/run-writeback-routing-evals.py`: routing eval runner
- `tests/routing_eval/`: routing eval tests
- `tests/skill_manager.test.mjs`: skill-manager CLI tests

Not yet implemented:

- learning event schema
- proposal queue
- skill proposal lifecycle
- learning review workflow
- compression loop

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

The first implemented command family is the skill manager:

```bash
noesis skill list [--workspace <path>|--agent-id <id>|--global] [--json]
noesis skill inspect <name> [--source <path>] [--json]
noesis skill verify [name] [--json]
noesis skill add <name> [--source <path>] [--alias <alias>] [--runtime codex|claude|both] [--json]
noesis skill remove <name> [--runtime codex|claude|both] [--json]
```

The skill manager manages symlink-based skill visibility in both `.codex/skills/` and `.claude/skills/`. It resolves managed sources under this package's `skills/` first, keeps `~/skills` as an external compatibility source, creates relative symlinks, repairs mismatched symlinks, refuses non-symlink conflicts, and removes only visibility links.

The managed `noesis-skill-manager` skill is a thin runtime entrypoint that delegates skill and capability work to `noesis skill ...`; it does not duplicate the CLI implementation.

Target resolution supports the current directory, explicit `--workspace`, pamem `--agent-id` via `pamem status --agent-id <id> --json`, and explicit `--global`. For pamem agents, skill visibility is managed on the resolved `root`; the shared `memory_repo` is reported for context but is not used as a `.codex/skills` or `.claude/skills` target.

Known Claude plugin capabilities (`humanize`, `superpowers`) are enabled and disabled through the official Claude plugin CLI when available, with `.claude/settings.json` fallback for environments without `claude`. The `pamem` runtime capability can be enabled or removed for Claude plugin runtime, Codex bootstrap, or both with `--runtime`; Codex bootstrap delegates to the installed pamem CLI. `memory-lint`, `memory-rule`, and `sync-request` are provided by `pamem` and are not managed as standalone symlink skills.

`@phlens/pamem` is a package dependency so `--agent-id` can resolve through the installed pamem bin. If the dependency bin is unavailable, the CLI falls back to `pamem` on `PATH`.

## Key Files

- `package.json`: npm package and bin metadata
- `bin/noesis`: Node CLI entrypoint
- `lib/skill-manager.mjs`: symlink skill visibility manager
- `docs/architecture.md`: current system boundary
- `docs/learning-lifecycle.md`: proposed learning lifecycle
- `findings.md`: accepted decisions and design findings
- `task_plan.md`: current work tracker
- `progress.md`: current progress and next steps
- `skills/noesis-skill-manager/SKILL.md`: thin runtime entrypoint for the skill-manager CLI
- `skills/writeback-router/SKILL.md`: current writeback-router skill
- `skills/writeback-router/references/intent-schema.md`: writeback intent schema reference
- `skills/writeback-router/references/routing-rules.md`: routing and review policy reference
- `examples/writeback-intent.example.json`: example writeback intent artifact
- `evals/writeback-routing.jsonl`: routing eval cases
- `evals/run-writeback-routing-evals.py`: routing eval runner

## Tagline

Noesis: a learning control plane for auditable agent self-improvement.
