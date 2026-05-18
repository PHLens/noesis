# Entry Skill Workflow

This document defines the first concrete daily-use workflow for Noesis after
the system boundary was narrowed to router plus skill manager.

The goal is to make promotion explicit and reviewable without turning Noesis
into a memory store, wiki engine, or autonomous self-modifying runtime.

## Runtime Entry Points

The daily runtime surface should stay small:

| Entry point | Owner | Purpose | Direct writes |
|---|---|---|---|
| pamem entry skill | pamem | load memory context, explain memory rules, request memory updates, run pamem lint/sync through pamem-owned policy | pamem-owned only |
| LoreForge entry skill | LoreForge | capture source-backed knowledge, stage wiki notes, run wiki validation, promote wiki content | LoreForge-owned only |
| writeback-router skill | Noesis | classify durable residue and emit writeback intent artifacts | no |
| noesis-skill-manager skill | Noesis | inspect, verify, add, or remove skills/capabilities through `noesis skill ...` | approved skill visibility only |

Noesis may package thin entry skills that point an agent to the right owner.
It must not reimplement pamem memory governance or LoreForge wiki mechanics.

## Normal Task Flow

Ordinary task completion should not trigger broad self-modification.

```text
task finishes
  -> agent identifies candidate learning residue
  -> transient chatter is discarded
  -> obvious runtime memory is handled by pamem rules
  -> source-backed domain knowledge is handed to LoreForge
  -> repeated procedures or missing capabilities become Noesis candidates
```

Use the writeback router only when there is meaningful durable residue. Do not
run it for every ordinary dialogue turn.

## Explicit Promote Flow

The first Noesis promote flow starts only when the user or an active workflow
explicitly asks to promote, gate, learn, or turn a repeated pattern into a
durable artifact.

```text
explicit promote request
  -> create promote-request artifact
  -> run Noesis routing and gate checks
  -> emit reviewable proposal(s)
  -> owner applies approved proposal
  -> Noesis records outcome and eval signal
```

The safe default is proposal-only. The first implementation should not apply
stable memory updates, wiki promotions, or skill changes directly.

## Promote Request Artifact

The promote request is local state, not durable memory.

Recommended path:

```text
.noesis/promote-requests/YYYY-MM-DDTHH-MM-SSZ__promote.json
```

Minimum fields:

| Field | Purpose |
|---|---|
| `schema_version` | Promote request schema version |
| `request_id` | Stable local ID |
| `created_at` | UTC creation time |
| `workspace` | Workspace where the request was created |
| `trigger` | Why promotion was requested |
| `source_refs` | Short references, not full transcripts |
| `candidate_items` | Items to route and gate |
| `requested_outputs` | Desired proposal or intent artifacts |
| `gate_policy` | Automation boundary for this request |

Candidate item fields:

| Field | Purpose |
|---|---|
| `id` | Stable item ID inside the request |
| `summary` | Compact non-transcript summary |
| `evidence` | Short evidence pointer or note |
| `candidate_kind` | `memory`, `wiki`, `skill`, `eval`, `compression`, `mixed`, or `unknown` |
| `risk` | `low`, `medium`, or `high` |
| `review_required` | Whether review is required before downstream application |
| `reason` | Why the item may deserve promotion |

## Gate Rules

Allowed automatically:

- create a promote-request artifact
- classify candidate items
- generate writeback intents
- draft isolated proposal artifacts
- run read-only lint, schema, and eval checks
- report a review queue

Requires review:

- stable pamem memory changes
- LoreForge wiki staging or promotion
- skill install, enable, update, or removal
- eval additions that change regression gates
- high-impact workflow rules
- superseding existing memory, knowledge, or skill behavior

Forbidden by default:

- saving full transcripts as learning artifacts
- hidden memory, wiki, or skill mutation
- direct sync executor behavior inside Noesis
- unreviewed self-modification
- promoting private or source-unsafe content

## First Implementation Slice

The first code slice should be small:

1. accept an explicit promote-request JSON file;
2. validate required fields and source-reference shape;
3. reuse writeback-router vocabulary where possible;
4. emit proposal-only output;
5. run existing routing evals and skill-manager verification;
6. never apply downstream changes.

This can be implemented before the full learning-event and proposal queue
schemas are finalized.

## Relationship To Existing CLI

Existing commands stay valid:

```bash
noesis skill list
noesis skill inspect <name>
noesis skill verify [name]
noesis skill add <name>
noesis skill remove <name>
```

The bootstrap command surface should use the manifest contract in
`docs/manifest-contract.md`:

```bash
noesis init --workspace <path> --with pamem,loreforge
noesis doctor --workspace <path>
noesis config show --workspace <path>
```

The first promote/gate command should be additive. A future command shape could
be:

```bash
noesis promote check .noesis/promote-requests/<id>.json
noesis promote plan .noesis/promote-requests/<id>.json --out .noesis/proposals/
```

`check` should be read-only. `plan` should write proposal artifacts only.

## Open Design Questions

- Should promote-request become the final learning-event schema, or remain a
  user-facing wrapper around learning events?
- Should proposal artifacts live under `.noesis/proposals/` or be delegated to
  downstream owner staging directories immediately?
- Which evals should gate skill proposals before `noesis skill add` is allowed?
- How should approved downstream application outcomes be recorded without
  making Noesis a third storage system?
