# Learning Event Schema

Learning events are the first intake artifact in the Noesis heuristic-system
loop. They capture compact evidence that a task may contain reusable behavior,
without deciding the final owner artifact.

The intake check command is:

```bash
noesis event check .noesis/events/<id>.json
noesis event check .noesis/events/<id>.json --json
```

`check` is read-only. It validates the event shape, compact source references,
case fields, impact metadata, optional routing hints, and transcript-retention
hazards. It does not route, write promote requests, write proposals, call
downstream owner commands, mutate memory, stage wiki content, or change skills.

The bridge command is:

```bash
noesis event promote .noesis/events/<id>.json
noesis event promote .noesis/events/<id>.json --json
```

`promote` reruns the read-only event check. If the event has check errors, it
writes nothing and exits `1`. If the event has no errors, it writes one
promote-request JSON artifact under `.noesis/promote-requests/` or an explicit
`--out` directory. It does not run proposal planning, update proposal review
state, call owner commands, mutate memory, stage wiki content, or change skills.

## Artifact Path

Recommended path:

```text
.noesis/events/YYYY-MM-DDTHH-MM-SSZ__learning-event.json
```

## Event Object

Required fields:

```json
{
  "schema_version": "0.1",
  "event_id": "2026-05-19T09-30-00Z__learning-event",
  "created_at": "2026-05-19T09:30:00Z",
  "workspace": "/path/to/workspace",
  "kind": "user_correction",
  "summary": "User corrected a workflow boundary.",
  "source_refs": [],
  "case": {},
  "impact": {}
}
```

Optional field:

```json
{
  "routing_hints": []
}
```

Rules:

- `schema_version` is `0.1`.
- `event_id` is stable within `.noesis/events/`.
- `created_at` uses ISO-8601 date-time format.
- `workspace` is the workspace where the event was observed.
- `source_refs` contains short references, not transcripts.
- `case` describes the observed behavior and desired behavior.
- `impact` describes severity, recurrence, and confidence.
- `routing_hints` may be absent or incomplete; task #12 owns conversion to a
  promote request.

## Event Kinds

Allowed `kind` values:

- `user_correction`
- `task_failure`
- `repeated_workflow`
- `missing_capability`
- `tool_behavior_discovery`
- `successful_pattern`
- `source_backed_insight`
- `stale_or_conflicting_learning`
- `manual`

## Source Reference Object

Required fields:

```json
{
  "kind": "slock_thread",
  "ref": "#heuristic-system:b3d21266",
  "summary": "Thread where the correction was discussed."
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
- `runtime_log`
- `manual_note`

Do not embed full transcripts, raw chat logs, message arrays, raw runtime logs,
private paths, or private tool output. Use short references and compact
summaries.

## Case Object

Required fields:

```json
{
  "situation": "When this behavior matters.",
  "observed": "What actually happened.",
  "desired": "What should happen next time.",
  "evidence": "Compact evidence or source summary."
}
```

The case object is intentionally descriptive. It should not decide the final
memory/wiki/skill/eval artifact.

## Impact Object

Required fields:

```json
{
  "severity": "medium",
  "recurrence": "repeated",
  "confidence": "high"
}
```

Allowed `severity` values:

- `low`
- `medium`
- `high`

Allowed `recurrence` values:

- `once`
- `repeated`
- `systemic`
- `unknown`

Allowed `confidence` values:

- `low`
- `medium`
- `high`

High severity with low confidence is allowed, but `check` reports a warning so
the event is manually reviewed before routing.

## Routing Hint Object

Optional routing hints may be provided by a human, router skill, or intake tool.
They are hints only; the bridge to promote-request is a separate step.

```json
{
  "candidate_kind": "eval",
  "target_surface": "evals",
  "review_required": true,
  "reason": "The behavior should become a regression case."
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

Missing, empty, or unknown routing hints produce warnings, not errors. This lets
intake happen before routing is fully known. `event promote` can still produce a
promote request from unresolved hints; the generated request keeps the unknown
candidate or owner surface so `noesis promote check` and review can resolve it
before planning or owner handoff.

## Check Report

JSON output has this shape:

```json
{
  "command": "event check",
  "status": "ok",
  "schema_version": "0.1",
  "event_path": "/path/to/event.json",
  "event_id": "2026-05-19T09-30-00Z__learning-event",
  "event_kind": "user_correction",
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
work that should be clarified before converting the event to a promote request.

## Promote Bridge

`noesis event promote` converts a checked learning event into the existing
promote-request schema. The bridge is deterministic and proposal-only:

- event `source_refs` become request `source_refs`;
- each routing hint becomes one `candidate_items[]` entry;
- `impact.severity` maps to candidate `risk`;
- known candidate kinds map to requested proposal outputs:
  - `memory` -> `memory_proposal` / `pamem`;
  - `wiki` -> `wiki_proposal` / `LoreForge`;
  - `skill` -> `skill_proposal` / `skill-manager`;
  - `eval` -> `eval_proposal` / `evals`;
  - `compression` -> `compression_proposal` / `Noesis`;
  - `noop` -> `noop` / `none`;
  - unresolved or mixed candidates -> `mixed` / `unknown`;
- generated `gate_policy` is always `mode=proposal_only`,
  `allow_apply=false`, and `review_required=true`.

JSON output has this shape:

```json
{
  "command": "event promote",
  "status": "ok",
  "event_path": "/path/to/event.json",
  "event_id": "2026-05-19T09-30-00Z__learning-event",
  "output_dir": "/path/to/workspace/.noesis/promote-requests",
  "request_path": "/path/to/workspace/.noesis/promote-requests/2026-05-19T09-30-00Z__learning-event__promote.json",
  "request_id": "2026-05-19T09-30-00Z__learning-event__promote",
  "downstream_execution": "not-run",
  "writes": ["/path/to/workspace/.noesis/promote-requests", "/path/to/request.json"],
  "summary": {
    "error_count": 0,
    "warning_count": 0,
    "info_count": 1,
    "request_count": 1
  },
  "event_check_report": {},
  "checks": []
}
```

Exit status is `1` only when the event check has errors or the target request
already exists without `--force`. Warnings preserve unresolved routing for
review.

## Boundary

Learning-event check is the intake gate. It does not:

- create promote requests;
- run routing or bridge logic;
- generate proposal artifacts;
- update proposal review state;
- apply memory, wiki, skill, or eval changes;
- retain full transcripts or raw logs.

Learning-event promote is the bridge to promote-request artifacts. It does not:

- generate proposal artifacts;
- update proposal review state;
- apply memory, wiki, skill, or eval changes;
- call downstream owner commands.
