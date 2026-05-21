# Eval Owner Handoff

Approved eval proposals need a visible owner-action artifact before an eval
owner creates or updates regression cases. Noesis writes that handoff as a
local report; it does not apply eval changes.

## CLI Surface

```bash
noesis eval handoff <proposal-id-or-path> [--workspace <path>] [--proposal-dir <dir>] [--out <dir>] [--reviewer <name>] [--note <text>] [--force] [--json]
```

Defaults:

- proposal directory: `.noesis/proposals/`
- report directory: `.noesis/reports/eval-handoffs/`

The input proposal must be:

- `schema_version: "0.1"`
- `proposal_type: "eval_proposal"`
- `target_owner: "evals"`
- `target_surface: "evals"`
- `status: "approved"`
- `automation_boundary.allow_apply: false`
- `automation_boundary.downstream_execution: "not-run"`
- `outcome.status: "not_applied"`

## Boundary

`noesis eval handoff` writes only a Noesis report under `.noesis/reports/`.
It does not:

- create files under `evals/`;
- run evals;
- update the proposal artifact;
- mutate memory, wiki, skills, or downstream owner state;
- mark the proposal as applied.

The report status starts as `pending_owner_action`. A future eval owner flow can
consume this report, create a regression artifact, run eval checks, and then
record an owner-owned outcome.

## JSON Envelope

`--json` returns:

```json
{
  "command": "eval handoff",
  "status": "ok",
  "schema_version": "0.1",
  "proposal_dir": "/path/to/.noesis/proposals",
  "reports_dir": "/path/to/.noesis/reports/eval-handoffs",
  "proposal_path": "/path/to/.noesis/proposals/example.json",
  "report_path": "/path/to/.noesis/reports/eval-handoffs/example__eval_handoff.json",
  "proposal_id": "example",
  "handoff_id": "example__eval_handoff",
  "downstream_execution": "not-run",
  "writes": ["/path/to/.noesis/reports/eval-handoffs/example__eval_handoff.json"],
  "report": {}
}
```

The report includes the proposal summary, source refs, candidate items,
acceptance checks, reviewer/note metadata, and an `owner_action` block with a
suggested eval artifact path. The suggested path is only a hint; creating that
artifact belongs to the eval owner workflow.
