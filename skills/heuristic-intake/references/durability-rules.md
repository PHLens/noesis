# Durability Rules

Use these rules before drafting a Noesis learning event.

## Create An Event

Create a learning event when at least one condition is true:

- The user explicitly asks to remember, learn, promote, gate, or apply a rule in
  future work.
- The user corrects an agent behavior boundary: authority, privacy, reply
  target, tool usage, review posture, owner boundary, or escalation path.
- A task fails in a way that can be converted into a future check, replay,
  workflow rule, or skill.
- The same workflow, correction, or manual workaround recurs.
- A stable tool or runtime behavior is discovered: CLI defaults, permission
  boundaries, path conventions, integration behavior, or reproducible failure
  mode.
- A missing capability is discovered: skill, eval, adapter, doctor check,
  router rule, or owner handoff.
- A source-backed domain insight should enter LoreForge rather than agent
  memory.
- Existing memory, knowledge, skill behavior, or eval coverage appears stale,
  conflicting, duplicated, or ready for compression.

## Do Not Create An Event

Do not create a learning event for:

- ordinary progress updates;
- temporary task state;
- one-off command output;
- raw logs or stack traces without a reusable lesson;
- details already fully handled by the current code/doc change and unlikely to
  recur;
- summaries of what the agent did;
- current-task TODOs;
- private paths, hostnames, usernames, tokens, customer data, or internal
  sensitive data;
- content with no source reference or evidence.

## Quality Gate

A useful event must answer:

- `situation`: when this behavior matters;
- `observed`: what actually happened;
- `desired`: what should happen next time;
- `evidence`: compact source-backed evidence.

If any of these are missing, ask for clarification or do not create the event.

## Impact Defaults

Use:

- `severity: "high"` for privacy, authority, data-loss, destructive command,
  security, or repeated severe workflow failures;
- `severity: "medium"` for repeated workflow friction, missing capability,
  durable correction, or owner-boundary mistakes;
- `severity: "low"` for minor stable tool behavior and low-risk workflow tips.

Use:

- `recurrence: "systemic"` when the issue affects a broad class of tasks or
  agents;
- `recurrence: "repeated"` when it has happened before or is likely to recur;
- `recurrence: "once"` when the signal is clear but only observed once;
- `recurrence: "unknown"` when evidence is insufficient.

Use:

- `confidence: "high"` when source evidence is direct and the desired behavior
  is clear;
- `confidence: "medium"` when the direction is clear but routing is uncertain;
- `confidence: "low"` when the event may be useful but needs human review.

`once + low` should usually stop at event intake and not become a promote
request without human review.

## Routing Hint Defaults

Routing hints are optional and non-final.

Use:

- `memory` / `pamem` for user preference, workflow rule, tool behavior
  discovery, or operating experience;
- `wiki` / `loreforge` for source-backed domain knowledge;
- `skill` / `skill-manager` for reusable procedures or missing capabilities;
- `eval` / `evals` for repeated failures, regressions, or desired checks;
- `compression` / `noesis` for stale or duplicated durable artifacts;
- `unknown` / `unknown` when classification needs the router or human review.

Noesis intake can draft unknown routing hints. The bridge to promote-request
must clarify them before owner application.
