---
name: code-review
description: Review pull requests, git diffs, or local worktrees for bugs, regressions, boundary mistakes, side effects, and missing tests. Use when the user asks for code review, PR review, diff review, branch review, or pre-merge review of code changes.
---

# Code Review

Review code changes with a findings-first workflow that stays focused on the actual change set. This skill is for code-change review, not spec or document review.

## Leaf Reviewer Fast Path

If the current task labels you as a leaf reviewer, reviewer worker, bounded reviewer, one review dimension, or not the coordinator, do not run the orchestration workflow below. Inspect only the assigned source and artifact set, return raw findings only, and do not spawn, wait on, follow up with, message, close, or list other agents.

This fast path exists for global skill installs where semantic matching can load this file for a worker prompt. In that case, treat the prompt as a single bounded review assignment and never launch another review fan-out.

Keep this skill separate from `doc-review`. They share the same high-level pattern when fan-out is useful, but code review is diff-first and behavior-risk-first, while doc review is artifact/decision-boundary-first.

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
3. `review_source`

Examples:

- `review_target`: PR URL, local diff, branch diff, worktree delta, base/head range
- `review_goal`: pre-merge review, regression check, runtime-risk review, test-gap review
- `review_source`: `local_diff`, `github_pr`, `gitlab_mr`, or another explicit source type

If `review_target`, `review_goal`, or `review_source` is missing, ask the smallest clarifying question needed before reviewing.

When the target is a PR or MR, include enough routing metadata before launching workers:

- source type: `github_pr`, `gitlab_mr`, or `local_diff`
- repository remote URL and host
- base ref and head ref
- PR or MR URL/number when available
- exact diff source the reviewer should use, such as local `git diff origin/main...HEAD`, GitHub PR API, or GitLab MR API

Do not make workers infer GitHub vs GitLab from the word "PR" or "MR". If no matching host-specific tool is available, pass a local diff or changed-file list instead of letting workers guess.

## Default Workflow

### 1. Confirm this is code review

Check whether the request is really about a code change.

- If yes, continue.
- If the real question is spec/doc/plan compliance, stop and direct the caller to `doc-review`.

### 2. Bound the review target

Review the change set first, then only the supporting context needed to evaluate it.

Usually this means:

- explicit source type and host, such as `github_pr`, `gitlab_mr`, or `local_diff`
- base/head refs or PR/MR URL
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

When fan-out is used, reviewer workers are leaf reviewers. They inspect only their assigned code-review dimension and return raw findings to the main session. They do not run another review orchestration, wait for sibling reviewers, or use agent coordination tools.

Use native reviewer subagents only when the runtime can reliably keep them leaf workers. If workers can call agent orchestration tools, consume sibling or parent mailbox updates, or launch their own review fan-out, use an isolated reviewer process or keep the review in the main session.

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
- not spawn, wait on, follow up with, message, close, or list other agents
- not wait for sibling reviewers or inspect agent registry state
- not run another review fan-out from inside the worker

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
- Do not let a reviewer worker become a coordinator or consume sibling reviewer output.

If the request clearly depends on document/spec compliance, explicitly recommend `doc-review`.

## References

- Default profile: [references/default-code-review-profile.md](references/default-code-review-profile.md)
- Reviewer and synthesis templates: [references/templates.md](references/templates.md)
- Claude/Codex reviewer backend notes: [references/claude-codex-exec.md](references/claude-codex-exec.md)
