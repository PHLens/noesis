# Learning Event Schema

Learning events are the first intake artifact in the Noesis heuristic-system
loop. They capture compact evidence that a task may contain reusable behavior,
without deciding the final owner artifact.

The first command is:

```bash
noesis event check .noesis/events/<id>.json
noesis event check .noesis/events/<id>.json --json
```

`check` is read-only. It validates the event shape, compact source references,
case fields, impact metadata, optional routing hints, and transcript-retention
hazards. It does not route, write promote requests, write proposals, call
downstream owner commands, mutate memory, stage wiki content, or change skills.

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
intake happen before routing is fully known.

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

## Boundary

Learning-event check is the intake gate. It does not:

- create promote requests;
- run routing or bridge logic;
- generate proposal artifacts;
- update proposal review state;
- apply memory, wiki, skill, or eval changes;
- retain full transcripts or raw logs.

Task #12 will define the bridge from checked events to promote-request
artifacts.
