# Learning Lifecycle

This document defines the target learning loop for Noesis as a heuristic system control plane.

## Lifecycle

```text
learning event
  -> route
  -> propose
  -> review
  -> apply through owner
  -> evaluate
  -> record outcome
  -> compress
```

## Learning Event

A learning event is a compact record that something in a task may be worth learning.

Examples:

- user correction
- repeated workflow
- repeated failure
- tool behavior discovery
- successful pattern
- missing skill
- source-backed domain insight
- stale or conflicting prior learning

Noesis should not store full transcripts by default. A learning event should carry short summaries and source references.

## Explicit Promote Request

The first daily-use interface may be a promote request rather than a fully
general learning event.

Use it when a user explicitly asks to promote, gate, learn, or turn a repeated
pattern into a durable artifact. A promote request is local state that points at
candidate learning residue and asks Noesis to route and gate it.

It should produce reviewable proposals only. Stable application remains owned
by pamem, LoreForge, skill-manager, or eval tooling.

## Routing

Routes should prefer the owner that can maintain the artifact long term:

| Event Type | Destination |
|---|---|
| user preference | pamem memory proposal |
| workflow correction | pamem memory proposal |
| tool behavior discovery | pamem memory proposal |
| domain concept | LoreForge wiki proposal |
| source summary | LoreForge wiki proposal |
| repeated procedure | skill proposal |
| repeated failure | eval proposal or skill proposal |
| stale repeated artifacts | compression proposal |
| current-task detail | discard or working memory |

Mixed events should be split when possible.

## Proposal Queue

Noesis should generate proposals rather than directly applying changes.

Common proposal fields:

- `id`
- `type`
- `status`
- `created_at`
- `source_refs`
- `summary`
- `target_owner`
- `target_path` or `target_capability`
- `rationale`
- `review_required`
- `risk`
- `acceptance_checks`
- `outcome`

Statuses:

- `pending`
- `approved`
- `rejected`
- `applied`
- `superseded`

## Skill Proposal

A skill proposal is the bridge from learning to capability.

Minimum fields:

- problem the skill solves
- evidence from repeated tasks, failures, or corrections
- trigger conditions
- proposed `SKILL.md` behavior
- required scripts, templates, or assets
- example tasks or regression cases
- rollback plan
- review status

The first safe target is autonomous skill proposal, not autonomous skill installation.

## Review Workflow

Noesis review should aggregate proposal state without taking ownership from downstream systems:

- memory proposals pending pamem review
- wiki proposals pending LoreForge review
- skill proposals pending capability review
- eval failures
- low-confidence routing decisions
- stale or conflicting learning artifacts

## Compression

The system must compress over time.

Examples:

- many learning events become one pamem rule
- many source notes become one LoreForge card or MOC
- many repeated procedures become one skill
- many failures become one eval case
- stale proposals become rejected or superseded

Without compression, the system only accumulates history instead of improving behavior.

## Evaluation

Evaluation prevents self-improvement from becoming drift.

Noesis already has routing evals. Future gates should include:

- learning router evals
- skill golden tasks
- workflow replay cases
- proposal validation
- compression quality checks

## Automation Boundary

Allowed automatically:

- capture candidate learning events
- generate proposals
- draft isolated skill changes
- run read-only evals
- report review queues

Requires approval:

- apply stable memory changes
- promote wiki changes
- install or enable skills
- supersede high-priority rules

Forbidden by default:

- unreviewed self-modification
- hidden transcript retention
- direct writes into downstream owners from Noesis
