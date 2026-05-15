---
name: shared-devflow
description: Shared default development workflow for coding agents. Use for software design, implementation, refactoring, debugging, testing, and repo changes that need worktree setup, skill orchestration, execution tracking, and verification. Agent-local or project-local workflow files may supplement project policy but must not override this shared flow.
---

# Shared Devflow

This skill defines the shared default development flow for code-focused agents across projects.

## Scope

Use this skill for:

- Software design and implementation work
- Refactors, debugging, and bug fixing
- Testing, verification, and code-quality work
- Repository changes that affect delivered code or behavior

Do not use this skill for:

- Persistent memory maintenance
- Communication-only work
- Project-policy lookup without actual development work

Agent-local workflow notes and project-local workflow files may supplement repository policy, but they must not override this shared development flow.

## Hard Boundary

- This skill governs development flow, not persistent memory management.
- Use `memory-rule` for persistent memory reads, writes, compression, and archiving.
- Memory-only or workflow-only maintenance tasks do not invoke this skill.

## Core Flow

1. Classify the task
2. Enter a dedicated task worktree before code edits
3. Choose the simple or complex path
4. Track execution with the required skills and files
5. Verify before completion
6. Report the result, verification, PR status or explicit no-PR decision, and residual risk

## Task Classification

- Memory-only or workflow-only maintenance: do not use this skill
- Simple development task: limited scope, low ambiguity, short execution path
- Complex development task: multiple phases, design ambiguity, research, or likely many tool calls

## Worktree Rules

- Do not modify project code in the main checkout when code changes are required.
- Use one git worktree per task.
- Use the same task worktree for design, planning, and implementation.
- Keep planning files inside that task worktree as local tracking only.
- One task worktree should map to one PR unless the user explicitly approves a different structure.
- For git-backed tasks, opening the PR or recording an explicit user-approved no-PR exception is part of task completion, not optional follow-up.
- Do not treat `in_review` as the closeout milestone for a git-backed task until the PR exists or the no-PR exception is explicitly recorded.
- After the task PR is merged, delete the associated task worktree.
- Before deleting a merged task worktree, summarize the essential contents of `task_plan.md`, `findings.md`, and `progress.md` into `notes/projects/<project-key>.md`.
- Before writing that summary, check whether the same `notes/projects/<project-key>.md` file already exists; if it does, append the new summary into that file instead of creating a duplicate project file.
- Each project summary entry must include:
  - the date
  - the PR link in Markdown format
  - a concise summary of the tracking-file content
- Keep `notes/projects/<project-key>.md` in reverse-chronological order, with the newest entry at the top.

## Multi-Instance Concurrency

When multiple agent instances run concurrently on different tasks, shared memory files (`MEMORY.md`, `notes/current-task.md`, `notes/work-log.md`, `notes/projects/<project-key>.md`) become write-contended.

### Rules

- During task execution, treat shared memory as **read-only**. All task state lives in the worktree (`task_plan.md`, `findings.md`, `progress.md`).
- Write to shared memory **only after task completion**, not during execution.
- `notes/current-task.md` uses a pointer format (list of active worktrees with one-line descriptions) so multiple instances can coexist without overwriting each other's entries.
- `MEMORY.md` Active Context uses pointer format (project name + pointer to `notes/projects/<project-key>.md`) instead of inline task details.
- On task start, add a one-line entry to `notes/current-task.md`. On task end, remove it and summarize into `notes/projects/<project-key>.md`.
- If last-write-wins occurs on a pointer file, the loss is limited to a pointer line; full state is recoverable from the worktree's `progress.md`.

## Skill Orchestration

### Simple Development Path

- Define a brief plan first.
- Invoke `planning-with-files`.
- Create `task_plan.md`, `findings.md`, and `progress.md` in the task worktree.
- Execute the task and keep planning files current.

### Complex Development Path

- Invoke `brainstorming` first.
- Do not implement until the design has been presented and approved.
- After design approval, invoke `planning-with-files` in the same task worktree.
- Execute implementation from that plan.

## Planning Rules

- `planning-with-files` is task-scoped execution tracking only.
- Re-read planning files when resuming after interruption.
- Keep planning files local unless the user explicitly wants them committed.
- Do not use planning files as durable memory or project policy storage.
- Keep `notes/current-task.md` as the startup-safe exported summary while planning files hold the detailed execution state.
- When `planning-with-files` is active, update `notes/current-task.md` with the task, project, phase, blocker, next step, and a pointer to `task_plan.md`.
- For git-backed tasks, keep `notes/current-task.md` explicit about branch/worktree and PR state: opened, pending, or intentionally not needed with the reason.
- On task close, remove the task from `notes/current-task.md` and keep only a concise summary in long-term memory.

## Verification Rules

- Run the narrowest meaningful verification that covers the change.
- Prefer project-native commands and targeted tests first.
- If verification could not be run, say so explicitly.
- Before finishing, check for obvious regressions, unhandled edge cases, and missing tests.

## Documentation Rules

- Update existing docs when the change affects documented behavior.
- Do not create new doc files unless the user requests them or the workflow explicitly requires them.
- Keep documentation aligned with the implemented behavior.

## Completion Rules

- Summarize what changed, how it was verified, and what remains risky or unresolved.
- Separate completed work from follow-up work that still needs review or approval.
- For git-backed tasks, include the PR URL in the handoff, or state explicitly that no PR will be opened and why.
- If a PR is expected, do not present the task as review-ready until the PR exists, unless the user explicitly asks for pre-PR review.
- Do not mark work as fully done if required review or approval is still pending.

## What Stays Local

The following belong in project-local workflow files, not this skill:

- Branch protection and merge policy
- Environment or toolchain choices for a specific repository
- Repository-specific test commands and verification recipes
- Project-specific artifact naming and summary conventions
- Repo-specific docs, review, or release gating
