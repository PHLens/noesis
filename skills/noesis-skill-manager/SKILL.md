---
name: noesis-skill-manager
description: Thin entrypoint for managing agent skill visibility and capability lifecycle through the noesis CLI. Use when listing, inspecting, verifying, adding, or removing skills/capabilities for a workspace, pamem agent id, or global scope.
---

# Noesis Skill Manager

Use this skill as the runtime entrypoint for skill and capability management.

This skill is intentionally thin. The source of truth is the `noesis skill` CLI in this repository. Do not manually create symlinks, edit `.claude/settings.json`, duplicate capability maps, or reimplement pamem bootstrap logic here.

## Use This When

Use this skill when the user asks to:

- list visible skills or capabilities
- inspect a skill, plugin capability, or runtime capability
- verify skill visibility or capability state
- add or remove a symlink skill
- enable or disable a known plugin capability
- enable or remove the `pamem` runtime capability

## Command Surface

```bash
noesis skill list [--workspace <path>|--agent-id <id>|--global] [--json]
noesis skill inspect <name> [--workspace <path>|--agent-id <id>|--global] [--source <path>] [--json]
noesis skill verify [name] [--workspace <path>|--agent-id <id>|--global] [--source <path>] [--json]
noesis skill add <name> [--workspace <path>|--agent-id <id>|--global] [--source <path>] [--alias <alias>] [--runtime codex|claude|both] [--json]
noesis skill remove <name> [--workspace <path>|--agent-id <id>|--global] [--runtime codex|claude|both] [--json]
```

Use `noesis help skill` or `noesis skill <command> --help` for current command help.

## Target Rules

- Default target is the current working directory.
- Use `--workspace <path>` for an explicit workspace root.
- Use `--agent-id <id>` for an agent managed by pamem; noesis resolves it through `pamem status --agent-id <id> --json`.
- Use `--global` only when the user explicitly asks for global skill visibility.
- Do not read `~/.claude/agents/<name>.md` or infer targets from Claude memory metadata.
- For pamem agents, noesis manages skill visibility at the resolved `root`. Shared `memory_repo` is contextual metadata, not a `.codex/skills` or `.claude/skills` target.

## Source Rules

For symlink skills, noesis resolves source directories in this order:

1. managed sources packaged under noesis `skills/`
2. external compatibility sources under `~/skills`
3. explicit `--source <path>` under either supported source root

Noesis creates relative symlinks in both `.codex/skills/` and `.claude/skills/`, repairs mismatched symlinks, rejects non-symlink conflicts, and removes only visibility links.

## Capability Rules

- Known plugin capabilities such as `humanize` and `superpowers` are managed through the Claude plugin CLI when available, with settings-json fallback only when the Claude CLI is absent.
- `pamem` is a runtime capability, not a standalone symlink skill. Use `--runtime claude`, `--runtime codex`, or `--runtime both` when adding or removing it.
- Do not add `memory-lint` or `memory-rule` as standalone skills; they are provided by pamem.

## If Noesis Is Missing

If `noesis` is not available on PATH, install the noesis package rather than implementing a local fallback:

```bash
npm install -g git+ssh://git@github.com/PHLens/noesis.git
```
