# Entry Skill Workflow

This document defines the first concrete entry-skill workflow for Noesis after
the system boundary was narrowed to routing plus skill management.

The goal is an explicit, reviewable promotion path for candidate heuristic
updates. Storage and application stay with the owning subsystem.

## Runtime Entry Points

The runtime surface stays small:

| Entry point | Owner | Purpose | Direct writes |
|---|---|---|---|
| pamem entry skill | pamem | load memory context, explain memory rules, request memory updates, run pamem lint/sync through pamem-owned policy | pamem-owned only |
| LoreForge entry skill | LoreForge | capture source-backed knowledge, stage wiki notes, run wiki validation, promote wiki content | LoreForge-owned only |
| writeback-router skill | Noesis | classify durable residue and emit writeback intent artifacts | no |
| noesis-skill-manager skill | Noesis | inspect, verify, add, or remove skills/capabilities through `noesis skill ...` | approved skill visibility only |

Noesis may package thin entry skills that route work to the owning subsystem.
pamem keeps memory governance, and LoreForge keeps wiki mechanics.

## Normal Task Flow

Ordinary task completion only creates promotion work when there is durable
learning residue.

```text
task finishes
  -> agent identifies candidate durable residue
  -> transient task detail is discarded
  -> obvious runtime memory is handled by pamem rules
  -> source-backed domain knowledge is handed to LoreForge
  -> repeated procedures or missing capabilities become Noesis candidates
```

Use the writeback router when there is meaningful durable residue.

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

The first implementation emits proposals only. Stable memory updates, wiki
promotions, and skill changes are applied by their owning systems after review.

## Promote Request Artifact

The promote request is local Noesis state.

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
| `target_surface` | Owning surface such as `pamem`, `loreforge`, `skill-manager`, `evals`, `noesis`, `none`, or `unknown` |
| `risk` | `low`, `medium`, or `high` |
| `review_required` | Whether review is required before downstream application |
| `reason` | Why the item may deserve promotion |

The concrete schema and check report are defined in
`docs/promote-request-schema.md`. See `examples/promote-request.example.json`
for a valid request artifact.

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

Disallowed by default:

- full transcript retention as a learning artifact
- hidden memory, wiki, or skill mutation
- sync executor behavior inside Noesis
- unreviewed behavior changes
- promotion of private or source-unsafe content

## First Implementation Slice

The first code slice should be small:

1. accept an explicit promote-request JSON file;
2. validate required fields and source-reference shape;
3. reuse writeback-router vocabulary where possible;
4. validate target surface, risk, review, and proposal-only gate boundaries;
5. reject transcript-like retention fields;
6. never write proposals or apply downstream changes.

This slice can ship before the full learning-event and proposal queue schemas.

The second code slice adds proposal-only planning:

1. rerun `check` against an explicit promote-request JSON file;
2. refuse to plan when check errors are present;
3. write isolated pending-review proposal artifacts under `.noesis/proposals/`
   or an explicit `--out` directory;
4. include owner, risk, candidate items, acceptance checks, and automation
   boundary in each proposal artifact;
5. never apply downstream owner changes.

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

The first promote/gate command should be additive. Candidate command shape:

```bash
noesis promote check .noesis/promote-requests/<id>.json
noesis promote plan .noesis/promote-requests/<id>.json --out .noesis/proposals/
```

`check` should be read-only. `plan` should write proposal artifacts only.

## Open Design Questions

- Should promote-request become the final learning-event schema, or remain a
  wrapper around learning events?
- Should proposal artifacts live under `.noesis/proposals/`, or should Noesis
  delegate immediately to downstream owner staging directories?
- Which evals should gate skill proposals before `noesis skill add` is allowed?
- How should approved downstream application outcomes be recorded without
  making Noesis a third storage system?
