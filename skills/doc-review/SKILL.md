---
name: doc-review
description: Main-session orchestration for repeated document and design review work by splitting review into explicit dimensions, running one leaf reviewer per dimension by default, and synthesizing a single findings-first result. Use for design docs, specs, plans, PRDs, RFCs, or similar non-code artifacts when review needs deduplication, severity judgment, and a unified response. Do not use inside a leaf reviewer worker spawned by this workflow.
---

# Doc Review

## Overview

Use this skill for repeated or high-context review of non-code artifacts when one review pass is not enough and the work benefits from:

- explicit review dimensions
- one reviewer worker per dimension by default
- main-session synthesis and deduplication
- a single findings-first reply

This skill is for document and design review orchestration only. `code-review` remains a separate skill because code review is diff-first and behavior-risk-first, while doc review is artifact/decision-boundary-first.

Use this skill only in the main coordinating session. A reviewer worker spawned by this workflow is a leaf reviewer: it answers its assigned question directly and does not run this orchestration workflow again.

The portable core of this skill is this `SKILL.md` file plus the files in `references/`.

## Portability

This skill is intended to stay platform-agnostic.

- The canonical workflow lives in `SKILL.md`.
- Reusable supporting material lives in `references/`.
- Any files under `agents/` are optional sidecar metadata for a specific platform or UI.
- If a runtime such as Claude or another agent host ignores `agents/`, the skill should still remain fully usable.

## Required Inputs

The main session should provide:

- `review targets`
- `review goal`
- `review source` when targets come from a PR, MR, branch, or local diff

Optional inputs:

- override review dimensions
- doc type
- known constraints
- extra context

When the target is hosted in version control, include enough source metadata before launching reviewers:

- source type: `local_diff`, `github_pr`, `gitlab_mr`, or another explicit source type
- repository remote URL or local path
- base ref and head ref when relevant
- PR or MR URL/number when available
- exact artifact source reviewers should use, such as local files, local `git diff`, GitHub PR API, or GitLab MR API

Do not make reviewer workers infer GitHub vs GitLab from generic PR/MR wording. If no matching host-specific tool is available, pass local artifacts or local diffs.

## When To Use

Use this skill when:

- reviewing specs, plans, PRDs, RFCs, design docs, or similar non-code artifacts
- the review is likely to span multiple passes or many tool calls
- duplicate findings are likely unless one session synthesizes the result
- subagent fan-out can reduce context bloat

Do not use this skill for:

- code review in v1
- one-shot lightweight review where dimension splitting adds more overhead than value
- tasks where the user only wants a rewrite or summary instead of a review

## Core Workflow

1. Confirm the review targets and review goal.
2. Choose the review dimensions.
   - Use the default design/doc profile unless the user overrides it.
   - See `references/default-design-doc-profile.md`.
   - Translate each dimension into one narrow review question or decision boundary.
   - Avoid open-ended prompts like "find anything wrong" when a tighter question can be asked instead.
3. Decide whether to fan out.
   - Default to one reviewer worker per review dimension.
   - Fall back to main-session-only review if the task is too small or the reviewer backend is unstable.
4. Choose the reviewer backend.
   - In Codex environments, native reviewer subagents are acceptable only when they can reliably stay leaf workers.
   - In Claude environments, prefer launching Codex reviewer workers through `codex exec` rather than Claude-native subagents.
   - If a backend lets reviewer workers call agent orchestration tools, consume sibling or parent mailbox updates, or recurse into this workflow, treat that backend as unstable for this review.
   - If available worker slots are fewer than the chosen review dimensions, batch the reviewers instead of failing the review.
5. Scope each reviewer's artifact set.
   - Start with the smallest authoritative artifact set that can answer the review dimension.
   - For large split-plan reviews, prefer starting from the top-level spec and coordinator/index plan.
   - Add split plans only when the review dimension cannot be answered from the top-level artifacts.
6. Launch reviewer workers.
   - Use the reviewer template in `references/templates.md`.
   - Each reviewer handles exactly one review dimension.
   - Each reviewer should get one explicit review question, not a broad "review everything" brief.
   - Reviewers should verify current artifacts directly rather than trusting prior summaries, commit descriptions, or previous review output.
   - Reviewers should default to approval unless they find an execution-relevant gap, contradiction, or ambiguity.
   - Make the leaf-reviewer boundary explicit in every prompt: reviewer workers do not coordinate, spawn, wait on, follow up with, or close other agents.
   - Reviewer workers must not invoke `doc-review` recursively. The main session has already applied this skill.
7. Wait with a bounded staged policy.
   - Use environment-specific defaults where available.
   - If reviewers do not produce final results within the bounded wait window, close the stalled reviewers and continue in the main session with the same review dimensions.
   - If a reviewer violates the leaf boundary, discard that worker output and treat the backend as unstable.
   - If the user forbids main-session fallback and the reviewer backend is unstable, stop and report the infrastructure failure instead of synthesizing.
8. Synthesize in the main session.
   - Start from reviewer status signals first, then inspect the underlying findings.
   - Deduplicate findings.
   - Merge severities.
   - Reject findings that are stylistic but not execution-relevant.
   - Separate true human confirmation points from reviewer-owned detail drift.
   - Use the synthesis template in `references/templates.md`.
9. Reply with a findings-first result.
   - Prefer a status-first summary such as `Approved`, `Needs Clarification`, or `Blocked`.
   - Put blocking or human-confirmation items ahead of non-blocking notes.
   - If the human has limited review bandwidth, compress the result to only the few decisions that actually need human confirmation.
   - Include a light next-step handoff by default.
   - Do not generate a full patch plan unless the user explicitly asks for it.

## Hard Boundaries

- Reviewer workers do not reply to the user directly.
- Reviewer workers do not update memory files.
- Reviewer workers return raw findings only to the main session.
- Reviewer workers do not use agent orchestration tools such as `spawn_agent`, `wait_agent`, `followup_task`, `send_message`, `close_agent`, or `list_agents`.
- Reviewer workers do not wait for sibling reviewers or inspect agent registry state.
- Reviewer workers do not invoke `doc-review` recursively; if they are launched by this workflow, they act as leaf reviewers only.
- Reviewer workers do not trust prior summaries as evidence that an issue is fixed or still open.
- Only the main session synthesizes, deduplicates, and assigns final severity.
- Only the main session updates durable memory.
- Only the main session decides whether to patch docs after the review result is stable.

## Anti-Patterns

- Treating reviewer outputs as final user-facing review results without synthesis
- Letting different reviewers report duplicate or conflicting findings directly to the user
- Letting a reviewer worker become a coordinator, wait for sibling reviewers, or consume the main session's mailbox updates
- Mixing review orchestration with immediate patch generation by default
- Expanding the scope to code review in v1
- Asking reviewers to perform broad "find anything wrong" sweeps when a narrower review question would produce higher-signal output
- Trusting earlier summaries, patch notes, or claimed fixes instead of verifying the current artifact set directly
- Forcing reviewer fan-out even when the task is too small to justify it
- Treating worker-slot exhaustion as a review failure instead of batching or queueing reviewer runs

## Optional Environment Profiles

The core workflow is review-generic. Environment-specific defaults should stay outside the core workflow.

Load `references/slock-defaults.md` only when the review is happening in the current Slock-style environment or another environment with similar task-thread, main-session, and memory responsibilities.

Do not treat that file as part of the mandatory cross-platform contract.

## References

- `references/default-design-doc-profile.md`
  - default review dimensions for design/doc review
- `references/templates.md`
  - subagent review template
  - main-session synthesis template
  - example override patterns
- `references/slock-defaults.md`
  - optional defaults for the current Slock-style environment
