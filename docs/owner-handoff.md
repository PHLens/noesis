# Owner Handoff

Approved proposals need a visible owner-lane artifact before pamem, LoreForge,
skill-manager, evals, or Noesis owner workflows materialize changes. Noesis
writes that handoff as local control-plane state. It does not apply owner
changes.

## CLI Surface

```bash
noesis owner handoff <proposal-id-or-path> [--workspace <path>] [--proposal-dir <dir>] [--out <dir>] [--reviewer <name>] [--note <text>] [--force] [--json]
```

Defaults:

- proposal directory: `.noesis/proposals/`
- handoff root: `.noesis/owner-handoffs/`
- handoff path: `.noesis/owner-handoffs/<owner>/pending/<handoff-id>.json`

The input proposal must be:

- `schema_version: "0.1"`
- `status: "approved"`
- known `target_owner`: `pamem`, `LoreForge`, `skill-manager`, `evals`, or
  `Noesis`
- not `proposal_type: "noop"`
- `automation_boundary.allow_apply: false`
- `automation_boundary.downstream_execution: "not-run"`
- `outcome.status: "not_applied"`

## Boundary

`noesis owner handoff` writes only a Noesis handoff artifact. It does not:

- call pamem, LoreForge, skill-manager, eval, or other owner commands;
- update proposal review state;
- mutate memory, wiki, skill, eval, or downstream owner state;
- mark the proposal as applied;
- create owner PRs, wiki drafts, skill changes, or eval files.

The handoff status starts as `pending_owner_action`. Owner workflows can consume
the handoff, run their own checks, materialize owner artifacts, and later record
an outcome through a separate outcome command.

## JSON Envelope

`--json` returns:

```json
{
  "command": "owner handoff",
  "status": "ok",
  "schema_version": "0.1",
  "proposal_dir": "/path/to/.noesis/proposals",
  "handoff_root": "/path/to/.noesis/owner-handoffs",
  "proposal_path": "/path/to/.noesis/proposals/example.json",
  "handoff_path": "/path/to/.noesis/owner-handoffs/pamem/pending/example__owner_handoff.json",
  "proposal_id": "example",
  "handoff_id": "example__owner_handoff",
  "target_owner": "pamem",
  "downstream_execution": "not-run",
  "writes": ["/path/to/.noesis/owner-handoffs/pamem/pending/example__owner_handoff.json"],
  "handoff": {}
}
```

The handoff artifact includes compact proposal context:

- proposal id, path, type, target owner, and target surface;
- source refs;
- candidate items;
- acceptance checks;
- requested output;
- reviewer/note metadata;
- owner action hints.

Owner action hints are not execution authority. They identify the expected owner
lane and a suggested next check, such as `pamem check` for memory proposals or
LoreForge validation for wiki proposals.
