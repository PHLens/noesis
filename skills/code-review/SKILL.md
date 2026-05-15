---
name: code-review
description: Review pull requests, git diffs, or local worktrees for bugs, regressions, boundary mistakes, side effects, and missing tests. Use when the user asks for code review, PR review, diff review, branch review, or pre-merge review of code changes.
---

# Code Review

Review code changes with a findings-first workflow that stays focused on the actual change set. This skill is for code-change review, not spec or document review.

## Use This When

Use this skill when the user asks to:

- review a PR
- review a branch or diff
- review a local worktree
- review code before merge
- check a code change for regressions, risks, or missing tests

Do not use this skill for specs, plans, RFCs, PRDs, or design docs. For those, use `doc-review`.

## Required Inputs

This skill needs:

1. `review_target`
2. `review_goal`

Examples:

- `review_target`: PR URL, local diff, branch diff, worktree delta, base/head range
- `review_goal`: pre-merge review, regression check, runtime-risk review, test-gap review

If either is missing, ask the smallest clarifying question needed before reviewing.

## Default Workflow

### 1. Confirm this is code review

Check whether the request is really about a code change.

- If yes, continue.
- If the real question is spec/doc/plan compliance, stop and direct the caller to `doc-review`.

### 2. Bound the review target

Review the change set first, then only the supporting context needed to evaluate it.

Usually this means:

- changed files
- relevant interface or dependency files
- targeted tests or test failures
- minimal runtime or migration context

Do not review the whole repo unless the caller explicitly asks for that.

Do not use the full session history as review context.

### 3. Apply the default code-review profile

Use the default review profile in [references/default-code-review-profile.md](references/default-code-review-profile.md).

By default, prioritize:

- bugs and regressions
- interface and boundary mistakes
- testing gaps
- side-effect, runtime, ops, or migration risk

Keep style-only comments and refactor ideas secondary.

### 4. Choose reviewer topology

Default:

- one main reviewer

Escalate to targeted fan-out only when the diff justifies it, such as:

- broad interface changes
- runtime-sensitive or operationally risky changes
- multi-subsystem diffs
- complicated testing or migration risk

The main session always owns synthesis, deduplication, and the final user-facing result.

### 5. Review statically first

Default to static review.

Minimal targeted verification is allowed when it materially improves confidence, for example:

- run one affected test
- confirm one parser or CLI behavior
- confirm one diff-scoped command outcome

Do not automatically expand into a broad test run unless the review goal explicitly requires it.

### 6. Return one unified review result

Use the synthesis contract in [references/templates.md](references/templates.md).

The default output is:

- findings-first
- unified, not a dump of raw reviewer notes
- one final status:
  - `Approved`
  - `Needs Fixes`
  - `Blocked`

Add a light next-step or repair hint by default.

## Reviewer Rules

When running reviewer workers or acting as the reviewer:

- inspect the work product directly
- verify relevant files or diffs instead of trusting prior summaries
- anchor findings to concrete evidence whenever possible
- downgrade weakly supported concerns instead of overstating them
- focus on behavior, contracts, regressions, and tests over taste
- avoid broad repo commentary unrelated to the requested change

Reviewer workers must:

- return raw findings only
- not reply to the user directly
- not write memory
- not implement fixes

## Output Rules

The default output must be findings-first.

Each real finding should normally include:

- severity
- title
- evidence
- why it matters
- a short repair hint

If the caller asks for inline-comment-ready output, you may switch to that mode. Otherwise return the unified default review result.

## Hard Boundaries

- Do not silently turn this into a spec/doc review.
- Do not let style comments crowd out correctness and risk.
- Do not audit the entire project unless asked.
- Do not treat session history as the review target.
- Do not overstate uncertain claims.

If the request clearly depends on document/spec compliance, explicitly recommend `doc-review`.

## References

- Default profile: [references/default-code-review-profile.md](references/default-code-review-profile.md)
- Reviewer and synthesis templates: [references/templates.md](references/templates.md)
- Claude/Codex reviewer backend notes: [references/claude-codex-exec.md](references/claude-codex-exec.md)
