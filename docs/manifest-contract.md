# Noesis Manifest And Component Contract

This document defines the P0 bootstrap contract for Noesis.

Noesis orchestrates component checks and local proposal state. Component
configuration, storage, and execution stay with the owning system.

## Directory Layout

Noesis owns only its local control-plane state:

```text
.noesis/
  config.toml
  events/
  promote-requests/
  proposals/
  reports/
```

Downstream systems keep their own config:

```text
.pamem/config.toml
.loreforge/config.toml
```

The `.noesis/config.toml` file is a manifest. It records component pointers,
required capabilities, version constraints, and Noesis-owned local state paths.
Downstream owner configs remain authoritative for their systems.

## Manifest Schema

The first manifest version is `0.1`.

Recommended path:

```text
.noesis/config.toml
```

Required top-level tables:

- `[noesis]`
- `[components.pamem]`
- `[components.loreforge]`
- `[components.skill_manager]`
- `[paths]`

### `[noesis]`

| Field | Required | Meaning |
|---|---|---|
| `schema_version` | yes | Manifest schema version |
| `workspace` | yes | Workspace root, relative path, or `${workspace}` placeholder |
| `entry_skill` | yes | Default Noesis intake entry skill |
| `minimum_noesis_version` | no | Minimum compatible Noesis version |
| `mode` | yes | `standalone`, `workspace`, or `agent` |

### `[components.<name>]`

Shared fields:

| Field | Required | Meaning |
|---|---|---|
| `enabled` | yes | Whether Noesis should check this component |
| `owner` | yes | Owning system name |
| `config_path` | no | Owner config path, if this component has one |
| `required_cli` | no | CLI executable Noesis should discover |
| `required_version` | no | Minimum compatible version |
| `required_entry_skill` | no | Runtime skill expected to be visible |
| `status_command` | no | Read-only status command contract executed during `doctor` |
| `init_command` | no | Initialization command contract |
| `validate_command` | no | Read-only validation command contract executed during `doctor` |

Noesis may call declared read-only commands during `doctor`. The downstream
owner defines the command semantics. Calling declared `init_command` values is a
future extension and requires an explicit command or flag.

### `[paths]`

| Field | Required | Meaning |
|---|---|---|
| `events` | yes | Local learning-event directory |
| `promote_requests` | yes | Local promote-request directory |
| `proposals` | yes | Local proposal directory |
| `reports` | yes | Local reports/doctor output directory |

Owner handoff reports may create subdirectories below `reports`, such as
`reports/eval-handoffs/`. Those reports are Noesis-owned local state and do not
imply downstream owner apply has happened.

## Component Contract

### pamem

Owner: `pamem`

Noesis may expect:

- `pamem setup` or equivalent component-facing profile/runtime binding during
  umbrella setup;
- `pamem install` / `pamem repair` or equivalent bootstrap refresh after a
  binding exists;
- `pamem status --json` or equivalent read-only status;
- `pamem lint` where available;
- pamem entry skill visibility when runtime integration is enabled.

Out of scope for Noesis:

- direct stable memory writes;
- `.pamem/config.toml` rewrites outside pamem-owned commands;
- pamem memory repo layout management.

### LoreForge

Owner: `LoreForge`

Noesis may expect:

- LoreForge initialization command;
- read-only status command;
- validation command for wiki structure and staged content;
- LoreForge entry skill visibility when wiki workflows are enabled.

The exact command names are left to the LoreForge owner contract. Generated
manifests use the stable `loreforge init` proposal-only CLI surface when that
CLI is discoverable. `noesis launch`/`setup` may replace that with the
write-capable `loreforge setup` owner command when the user provides an explicit
LoreForge wiki path and domain. The generated LoreForge commands use a
workspace-local `.noesis/loreforge/registry.toml` by default, or an explicit
`--loreforge-registry` path, so component bootstrap does not assume or mutate
the user's default machine-local LoreForge registry. If the CLI is not
available, Noesis still declares the component but leaves it disabled. Noesis
consumes declared component commands from the manifest and leaves wiki mechanics
to LoreForge. Read-only `status_command` and `validate_command` are added only
after setup has enough LoreForge information to check the configured wiki.

Out of scope for Noesis:

- direct wiki staging or promotion;
- wiki directory ownership;
- wiki backend propagation;
- domain-path inference without LoreForge rules.

### skill-manager

Owner: `Noesis`

Noesis owns:

- `noesis skill list`;
- `noesis skill inspect`;
- `noesis skill verify`;
- approved `noesis skill add/remove` lifecycle operations.

Skill-manager should be used by Noesis after promote/gate review approves a
capability change.

## Doctor Semantics

`noesis doctor` is read-only for Noesis-owned state.

It may check:

- `.noesis/config.toml` exists and parses;
- manifest version is supported;
- component config paths exist when enabled;
- declared CLIs are discoverable;
- declared status/validate commands return success;
- declared status/validate commands emit a JSON envelope with `status: "ok"`
  or `ok: true` for a passing component check;
- required entry skills are visible;
- Noesis local state directories exist or can be reported missing.

The JSON report includes both a detailed `checks[]` list and a grouped
`readiness` summary for umbrella HS health:

- `noesis`: manifest and Noesis-owned local state directories;
- `entry_skills`: the Noesis entry skill plus required component entry skills;
- `pamem`: pamem memory owner component readiness;
- `loreforge`: LoreForge knowledge component readiness;
- `skill_manager`: Noesis skill-manager readiness.

Disabled components report `status: "disabled"` in their readiness section.
Missing or failing enabled components report warnings unless the manifest itself
is invalid.

The component command trust boundary is the manifest. `doctor` executes
declared `status_command` and `validate_command` values and expects the owner to
keep those commands read-only. Noesis does not sandbox or rewrite those command
semantics.

It leaves unchanged:

- owner configs;
- memory, wiki, and skill state;
- installed capabilities;
- owner backend propagation state;
- proposal application state.

## Init Semantics

`noesis launch` is the user-facing workspace/runtime entrypoint. It runs the
prepare path, delegates memory/wiki configuration to owner setup commands, runs
doctor, and then starts or binds the selected runtime. `noesis update` is the
user-facing maintenance entrypoint for Noesis-managed local tooling and
components. `noesis init` creates Noesis-owned local state only. The lower-level
`noesis setup` command remains an advanced prepare surface used by launch and
tests. Component discovery and local component installation/update are
Noesis-owned prepare/update behavior, not a separate `noesis component` command
surface.

Allowed:

- create `.noesis/config.toml`;
- create `.noesis/events/`, `.noesis/promote-requests/`, `.noesis/proposals/`, and `.noesis/reports/`;
- run read-only doctor checks after initialization.

`noesis launch`/`setup` may:

- install Noesis entry skills;
- resolve explicit, environment-provided, nearby, or managed local component
  sources;
- clone missing enabled components through setup `--install-components`;
- fast-forward component git checkouts when the user passes
  `--update-components`;
- call component-owned setup/install/repair entrypoints with explicit arguments;
- write component command pointers into `.noesis/config.toml`;
- run read-only doctor checks after initialization.

`noesis launch` may additionally:

- clone missing components required by the requested launch setup: pamem for
  plain runtime launch, and LoreForge only when explicitly enabled or when
  wiki/domain setup is requested;
- create or repair CLI agent homes under pamem's configured data directory;
- bind existing Slock workspaces without creating or resuming a Slock agent;
- record CLI runtime session metadata;
- start the selected CLI runtime only after doctor reports no errors.

`noesis update` may additionally:

- update the Noesis checkout when it is a git checkout with an upstream;
- install missing enabled pamem/LoreForge components into the managed component
  directory by default;
- fast-forward resolved pamem/LoreForge git checkouts.

Requires explicit command intent, flags, or review:

- updating component checkouts through `noesis update` or setup
  `--update-components`;
- enabling runtime capabilities;
- overwriting existing config files.

Out of scope:

- stable pamem memory writes;
- LoreForge wiki staging or promotion;
- skill changes without approval;
- credentials or private owner tokens in `.noesis/config.toml`.

## Failure Handling

Bootstrap must be idempotent.

If one component succeeds and another fails, Noesis should:

- leave successfully created owner configs in place;
- write or print a repairable doctor report;
- avoid rolling back downstream owner state unless that owner provides a safe
  rollback command;
- allow rerunning `noesis init` and `noesis doctor`.

## Versioning

Use three independent version axes:

- Noesis manifest schema version;
- downstream component CLI versions;
- downstream component config schema versions.

Noesis rejects unsupported manifest versions and warns on unsupported component
versions. Downstream owner config migration belongs to the owning system.
