# Learning Lifecycle

This document defines the target learning loop for Noesis as a heuristic system control plane.

## Lifecycle

```text
learning event
  -> event promote bridge
  -> promote request
  -> proposal plan
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

The first intake command is:

```bash
noesis event check .noesis/events/<id>.json
noesis event promote .noesis/events/<id>.json
noesis route .noesis/events/<id>.json
```

`event check` validates the event but does not route it, create a promote
request, write proposal artifacts, or apply downstream owner changes. Missing
or unresolved routing hints are warnings so intake can happen before routing is
complete.

`event promote` reruns the event check and writes one promote-request artifact
only. It maps routing hints into candidate items and requested outputs, but
does not plan proposals or apply downstream owner changes.

`route` is the high-level command for the common path. It composes the
same gates in sequence: event check/promote, then promote check/plan. This
reduces operator steps without merging the gate semantics. If event promotion
or promote planning has errors, the next step is not run.

See `docs/learning-event-schema.md`.

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

- `proposal_id`
- `proposal_type`
- `status`
- `created_at`
- `updated_at`
- `source_refs`
- `summary`
- `target_owner`
- `target_surface`
- `rationale`
- `review_required`
- `risk`
- `acceptance_checks`
- `review_history`
- `outcome`

Statuses:

- `pending_review`
- `approved`
- `rejected`
- `applied`
- `superseded`

`applied` is reserved for owner-owned apply flows. The Noesis review CLI can
mark proposals `approved`, `rejected`, or `superseded`, but it does not apply
downstream changes.

The first queue CLI is:

```bash
noesis proposal list
noesis proposal summary
noesis proposal show <proposal-id-or-path>
noesis proposal update <proposal-id-or-path> --status approved
noesis owner handoff <proposal-id-or-path>
noesis owner outcome <proposal-id-or-path> --status owner_pending --ref pr:<url>
noesis eval handoff <proposal-id-or-path>
```

See `docs/proposal-queue.md`.

## Owner Outcome Record

After owner review starts or finishes, `noesis owner outcome` links owner-side
refs back to the proposal queue. Typical refs are owner PRs, drafts, commits,
reports, or handoff artifacts.

This is still Noesis control-plane state:

- it writes only the proposal artifact's `outcome` and `outcome_history`;
- it does not call owner commands;
- it does not create owner PRs, wiki drafts, skill changes, memory entries, or
  eval files;
- `downstream_execution` remains `not-run`.

## Eval Owner Handoff

`noesis eval handoff` is the first owner-specific handoff skeleton. It consumes
an approved `eval_proposal` and writes a report under
`.noesis/reports/eval-handoffs/`.

The report is a pending owner-action artifact, not an applied eval. It preserves
the Noesis boundary:

- no eval files are created;
- no evals are executed;
- no proposal outcome is marked applied;
- downstream owner state is unchanged.

See `docs/eval-handoff.md`.

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

Future gates should include:

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
