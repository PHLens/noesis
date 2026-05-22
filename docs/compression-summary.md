# Compression Summary

`noesis compression summary` is the first read-only compression loop surface.
It scans accumulated Noesis learning artifacts and reports candidates for
later human or owner review.

It does not create compression proposals. It does not apply memory, wiki, skill,
or eval changes.

## CLI Surface

```bash
noesis compression summary [--workspace <path>] [--event-dir <dir>] [--proposal-dir <dir>] [--min-group-size <n>] [--stale-days <days>] [--json]
```

Defaults:

- `--event-dir .noesis/events`
- `--proposal-dir .noesis/proposals`
- `--min-group-size 2`
- `--stale-days 30`

## What It Reports

The command groups three classes of compression candidate:

- `repeated_events`: learning events with the same candidate kind, target owner,
  target surface, and compact summary.
- `repeated_proposals`: proposals with the same proposal type, target owner,
  target surface, and compact summary.
- `stale_proposals`: pending-review proposals older than the stale threshold,
  grouped by proposal type, target owner, and target surface.

Each candidate is a Noesis-owned suggestion:

- `suggested_proposal_type: "compression_proposal"`
- `suggested_target_owner: "Noesis"`
- `suggested_target_surface: "noesis"`
- `automation_boundary.allow_apply: false`
- `downstream_execution: "not-run"`

The source artifacts remain in place. A reviewer can use the report to decide
whether to create a later compression proposal, supersede old proposals, or ask
the relevant owner to consolidate the repeated learning into a stable artifact.

## Boundary

The summary command is read-only. It reports `writes=[]` and never creates:

- compression proposals;
- owner handoff artifacts;
- pamem memory entries;
- LoreForge wiki drafts;
- skill visibility links;
- eval files or eval handoff reports.

Invalid JSON artifacts are reported as warnings/errors in the summary but do
not block the report.

## JSON Envelope

`--json` returns:

```json
{
  "command": "compression summary",
  "status": "warning",
  "schema_version": "0.1",
  "workspace": "/path/to/workspace",
  "event_dir": "/path/to/workspace/.noesis/events",
  "proposal_dir": "/path/to/workspace/.noesis/proposals",
  "thresholds": {
    "min_group_size": 2,
    "stale_after_days": 30
  },
  "summary": {
    "event_count": 2,
    "proposal_count": 2,
    "candidate_count": 2,
    "repeated_event_candidate_count": 1,
    "repeated_proposal_candidate_count": 1,
    "stale_proposal_candidate_count": 0,
    "warning_count": 0,
    "error_count": 0
  },
  "downstream_execution": "not-run",
  "writes": [],
  "warnings": [],
  "candidates": []
}
```

`status` is `warning` when candidates or artifact warnings are present, and
`ok` when there is nothing to act on.
