# Eval Replay

`noesis eval replay` runs route/proposal golden cases against the Noesis control
plane. It is a regression runner for the proposal-only learning path, not an
owner apply command.

## CLI Surface

```bash
noesis eval replay [case-file...] [--tmp-root <dir>] [--keep-workspaces] [--json]
```

When no case file is provided, Noesis uses the packaged golden case:

```text
examples/eval-replay.route-proposal.golden.json
```

Each case contains:

- `schema_version: "0.1"`
- `case_id`
- `input.event`: a compact learning-event artifact
- `expect`: partial golden expectations for route status, summary, promote
  request fields, proposal fields, and owner-state absence

`$WORKSPACE` inside the case is replaced with the temporary replay workspace.

## Boundary

Replay creates an isolated temporary workspace, writes the case's learning event
under `.noesis/events/`, and runs the route flow in-process. It writes only
temporary Noesis artifacts:

- `.noesis/events/`
- `.noesis/promote-requests/`
- `.noesis/proposals/`

It does not:

- call pamem, LoreForge, skill-manager, or eval owner commands;
- create owner handoffs or eval handoff reports;
- create files under `evals/`;
- mutate stable memory, wiki, skills, or downstream owner state.

The owner-state absence invariant checks `.pamem/`, `.loreforge/`, `.codex/`,
`.claude/`, `.noesis/owner-handoffs/`, `.noesis/reports/eval-handoffs/`, and
`evals/` inside the temporary workspace.

`downstream_execution` remains `not-run`. Temporary workspaces are removed by
default; use `--keep-workspaces` only when inspecting a replay failure.

## JSON Envelope

`--json` returns:

```json
{
  "command": "eval replay",
  "status": "ok",
  "schema_version": "0.1",
  "case_files": ["/path/to/golden.json"],
  "downstream_execution": "not-run",
  "side_effects": "temporary-workspace-removed",
  "writes": [],
  "summary": {
    "case_count": 1,
    "passed_count": 1,
    "failed_count": 0,
    "error_count": 0,
    "warning_count": 0,
    "info_count": 0
  },
  "cases": []
}
```

If `--keep-workspaces` is set, `writes` includes the temporary Noesis artifacts
left behind for inspection. Without it, `writes` is empty because the replay
workspace has been removed.
