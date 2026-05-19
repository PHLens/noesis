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

Learning events carry short summaries and source references. Full transcripts
stay outside the default learning record.

## Explicit Promote Request

The first user-facing interface may be a promote request.

Use it when a user explicitly asks to promote, gate, learn, or turn a repeated
pattern into a durable artifact. A promote request is local state that points at
candidate learning residue and asks Noesis to route and gate it.

It produces reviewable proposals. Stable application remains owned by pamem,
LoreForge, skill-manager, or eval tooling.

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

Noesis generates proposals before downstream systems apply changes.

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

The first automation target is skill proposal generation. Skill installation
requires approval.

## Review Workflow

Noesis review aggregates proposal state while downstream systems keep ownership:

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

Compression converts accumulated history into maintained artifacts.

## Evaluation

Evaluation limits behavior drift.

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

Disallowed by default:

- unreviewed behavior changes
- hidden transcript retention
- direct writes into downstream owners from Noesis
