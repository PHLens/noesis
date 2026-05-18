# Noesis Manifest And Component Contract

This document defines the P0 bootstrap contract for an independent Noesis
development path.

Noesis may orchestrate pamem and LoreForge, but it must not absorb their
configuration, storage, or execution responsibilities.

## Directory Layout

Noesis owns only its local control-plane state:

```text
.noesis/
  config.toml
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
It is not a replacement for downstream owner configs.

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
| `entry_skill` | yes | Noesis router entry skill |
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
| `status_command` | no | Read-only status command contract |
| `init_command` | no | Initialization command contract |
| `validate_command` | no | Read-only validation command contract |

Noesis may call declared read-only commands during `doctor`, but the downstream
owner defines the command semantics. Calling declared `init_command` values is a
future extension and must remain explicit.

### `[paths]`

| Field | Required | Meaning |
|---|---|---|
| `promote_requests` | yes | Local promote-request directory |
| `proposals` | yes | Local proposal directory |
| `reports` | yes | Local reports/doctor output directory |

## Component Contract

### pamem

Owner: `pamem`

Noesis may expect:

- `pamem init` or equivalent initialization;
- `pamem status --json` or equivalent read-only status;
- `pamem lint` where available;
- pamem entry skill visibility when runtime integration is enabled.

Noesis must not:

- write stable memory directly;
- rewrite `.pamem/config.toml` except through pamem-owned commands;
- run private sync backends;
- manage pamem memory repo layout.

### LoreForge

Owner: `LoreForge`

Noesis may expect:

- LoreForge initialization command;
- read-only status command;
- validation command for wiki structure and staged content;
- LoreForge entry skill visibility when wiki workflows are enabled.

The exact command names are intentionally left to the LoreForge owner contract.
Noesis should treat them as declared component commands, not hard-code internal
wiki mechanics.

Noesis must not:

- stage or promote wiki notes directly;
- own wiki directory structure;
- run wiki sync backends;
- infer domain paths without LoreForge rules.

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

`noesis doctor` should be read-only.

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

It must not:

- create missing owner configs;
- mutate memory/wiki/skill state;
- install capabilities;
- run sync;
- apply proposals.

## Init Semantics

`noesis init` creates Noesis-owned local state. Delegating downstream setup is a
future extension and must remain explicit.

Allowed:

- create `.noesis/config.toml`;
- create `.noesis/promote-requests/`, `.noesis/proposals/`, and `.noesis/reports/`;
- run read-only doctor checks after initialization.

Requires explicit flags or review:

- calling downstream owner init commands;
- installing missing CLIs;
- enabling runtime capabilities;
- adding skills;
- overwriting existing config files.

Forbidden:

- writing stable pamem memory;
- staging/promoting LoreForge wiki content;
- applying skill changes without approval;
- storing credentials or private sync tokens in `.noesis/config.toml`.

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

Noesis should reject unsupported manifest versions and warn on unsupported
component versions. It should not migrate downstream owner configs directly.
