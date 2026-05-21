# Promote Request Schema

This document defines the first Noesis promote-request schema and read-only
gate. It is intentionally smaller than the future proposal queue.

## Scope

A promote request is a compact artifact that says: this task produced durable
learning residue, these are the short evidence references, and these are the
candidate owner surfaces. It does not apply changes.

The first gate command is:

```bash
noesis promote check .noesis/promote-requests/<id>.json
noesis promote check .noesis/promote-requests/<id>.json --json
```

`check` is read-only. It reads one JSON file and reports schema, source,
owner-boundary, review-boundary, and transcript-retention issues. It does not
write `.noesis/proposals/`, call downstream owner apply commands, mutate memory,
stage wiki content, or change skills.

After `check` passes, the first proposal-only planner command is:

```bash
noesis promote plan .noesis/promote-requests/<id>.json --out .noesis/proposals/
noesis promote plan .noesis/promote-requests/<id>.json --json
```

`plan` reruns `check` first. If check errors are present, it writes nothing and
exits `1`. If check has only warnings, it may write proposal artifacts and
returns a warning status so reviewers can resolve the open issues before owner
application.

## Artifact Path

Recommended path:

```text
.noesis/promote-requests/YYYY-MM-DDTHH-MM-SSZ__promote.json
```

## Batch Object

Required fields:

```json
{
  "schema_version": "0.1",
  "request_id": "2026-05-19T06-00-00Z__promote",
  "created_at": "2026-05-19T06:00:00Z",
  "workspace": "/path/to/workspace",
  "trigger": {},
  "source_refs": [],
  "candidate_items": [],
  "requested_outputs": [],
  "gate_policy": {}
}
```

Optional field:

```json
{
  "expected_regression": {}
}
```

Rules:

- `schema_version` is `0.1`.
- `request_id` is stable within `.noesis/promote-requests/`.
- `created_at` uses ISO-8601 date-time format.
- `workspace` is the workspace where the request was produced.
- `source_refs` contains short references, not transcripts.
- `candidate_items` contains one or more routeable learning candidates.
- `requested_outputs` names the reviewable proposal or noop output requested.
- `gate_policy` must keep the first slice proposal-only.

## Trigger Object

Required fields:

```json
{
  "kind": "user_correction",
  "summary": "The user corrected a workflow boundary."
}
```

Allowed `kind` values:

- `user_request`
- `user_correction`
- `task_failure`
- `repeated_workflow`
- `missing_capability`
- `manual`

Optional field:

```json
{
  "requested_by": "@Percy"
}
```

## Source Reference Object

Required fields:

```json
{
  "kind": "slock_thread",
  "ref": "#heuristic-system:59062ab8",
  "summary": "Task thread where the promote gate was requested."
}
```

Allowed `kind` values:

- `slock_message`
- `slock_thread`
- `task`
- `test`
- `pr`
- `doc`
- `file`
- `url`
- `manual_note`

Do not embed full transcripts, raw chat logs, message arrays, internal paths, or
private tool output. Use short references and compact summaries.

## Candidate Item Object

Required fields:

```json
{
  "id": "item-1",
  "summary": "A durable behavior candidate.",
  "evidence": "Short source pointer or note.",
  "candidate_kind": "skill",
  "target_surface": "skill-manager",
  "risk": "medium",
  "review_required": true,
  "reason": "This repeated workflow may deserve a reusable capability."
}
```

Allowed `candidate_kind` values:

- `memory`
- `wiki`
- `skill`
- `eval`
- `compression`
- `mixed`
- `noop`
- `unknown`

Allowed `target_surface` values:

- `pamem`
- `loreforge`
- `skill-manager`
- `evals`
- `noesis`
- `none`
- `unknown`

Allowed `risk` values:

- `low`
- `medium`
- `high`

`high` risk items must set `review_required` to `true`. `unknown` kind or
surface is allowed so early triage can continue, but the check reports a warning
until routing is clarified.

Optional item-specific `source_refs` may be provided with the same source
reference schema.

## Requested Output Object

Required fields:

```json
{
  "kind": "skill_proposal",
  "target_owner": "skill-manager",
  "review_required": true
}
```

Allowed `kind` values:

- `memory_proposal`
- `wiki_proposal`
- `skill_proposal`
- `eval_proposal`
- `compression_proposal`
- `noop`
- `mixed`

Allowed `target_owner` values:

- `pamem`
- `LoreForge`
- `skill-manager`
- `evals`
- `Noesis`
- `none`
- `unknown`

Proposal outputs should require review unless the requested output is `noop`.

## Gate Policy Object

Required fields:

```json
{
  "mode": "proposal_only",
  "allow_apply": false,
  "review_required": true
}
```

For task #6, `allow_apply` must be `false`. Applying stable memory, wiki,
skill, or eval changes belongs to owner systems after review.

## Expected Regression Object

Optional but recommended:

```json
{
  "kind": "golden_case",
  "scenario": "A future task produces the same correction.",
  "acceptance": "Noesis routes it to the same target surface and requires review."
}
```

Allowed `kind` values:

- `golden_case`
- `checklist`
- `unit_test`
- `manual_review`

The check reports a warning when this object is absent. That warning should be
resolved before a proposal plan becomes a durable behavior change.

## Check Report

JSON output has this shape:

```json
{
  "command": "promote check",
  "status": "ok",
  "schema_version": "0.1",
  "request_path": "/path/to/request.json",
  "request_id": "2026-05-19T06-00-00Z__promote",
  "summary": {
    "error_count": 0,
    "warning_count": 0,
    "info_count": 10
  },
  "downstream_execution": "not-run",
  "writes": [],
  "checks": []
}
```

Exit status is `1` when errors are present and `0` otherwise. Warnings indicate
work that should be clarified before planning.

## Proposal Artifact

`plan` writes one JSON file per requested output. The default output directory is:

```text
.noesis/proposals/
```

Artifact path:

```text
.noesis/proposals/<request_id>__NN__<proposal_type>.json
```

Proposal artifacts are review records. They are not applied changes.

Common fields:

```json
{
  "schema_version": "0.1",
  "proposal_id": "2026-05-19T06-00-00Z__promote__01__eval_proposal",
  "proposal_type": "eval_proposal",
  "status": "pending_review",
  "created_at": "2026-05-19T07:00:00.000Z",
  "request_id": "2026-05-19T06-00-00Z__promote",
  "request_path": ".noesis/promote-requests/2026-05-19T06-00-00Z__promote.json",
  "source_refs": [],
  "trigger": {},
  "target_owner": "evals",
  "target_surface": "evals",
  "review_required": true,
  "risk": "medium",
  "summary": "Short proposal summary.",
  "rationale": "Why the proposal should exist.",
  "candidate_items": [],
  "requested_output": {},
  "acceptance_checks": [],
  "automation_boundary": {
    "mode": "proposal_only",
    "allow_apply": false,
    "downstream_execution": "not-run",
    "owner_apply_required": true
  },
  "outcome": {
    "status": "not_applied",
    "applied_by": null,
    "applied_at": null
  }
}
```

The artifact must preserve the review boundary:

- `status` starts as `pending_review`.
- `automation_boundary.allow_apply` is `false`.
- `automation_boundary.downstream_execution` is `not-run`.
- `outcome.status` starts as `not_applied`.

Existing proposal files are not overwritten unless `--force` is provided.

## Proposal Queue Review

After `plan` writes proposal artifacts, the queue can be inspected and reviewed
with:

```bash
noesis proposal list --workspace /path/to/workspace
noesis proposal summary --workspace /path/to/workspace --json
noesis proposal show <proposal-id-or-path> --json
noesis proposal update <proposal-id-or-path> --status approved --reviewer @Percy
```

`proposal list`, `proposal summary`, and `proposal show` are read-only.
`proposal update` writes only the selected proposal artifact's review metadata.
It does not apply owner changes.

Review statuses:

- `pending_review`
- `approved`
- `rejected`
- `superseded`

`applied` is reserved for a future owner-apply flow and cannot be set by the
review CLI.

When a proposal is updated, Noesis appends a compact `review_history` entry and
sets `updated_at`. It preserves `automation_boundary.allow_apply=false` and
`outcome.status=not_applied`.

See `docs/proposal-queue.md`.

## Plan Report

JSON output has this shape:

```json
{
  "command": "promote plan",
  "status": "ok",
  "schema_version": "0.1",
  "request_path": "/path/to/request.json",
  "request_id": "2026-05-19T06-00-00Z__promote",
  "output_dir": "/path/to/.noesis/proposals",
  "downstream_execution": "not-run",
  "writes": [
    "/path/to/.noesis/proposals/2026-05-19T06-00-00Z__promote__01__eval_proposal.json"
  ],
  "summary": {
    "error_count": 0,
    "warning_count": 0,
    "info_count": 1,
    "proposal_count": 1
  },
  "check_report": {},
  "proposals": []
}
```

`writes` reports only proposal-plan artifacts and directories that Noesis
created or overwrote. It does not include downstream owner writes because plan
does not perform them.
