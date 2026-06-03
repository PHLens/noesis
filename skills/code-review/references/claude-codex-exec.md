# Claude / Codex Reviewer Backend Notes

The review contract stays the same across environments, but the reviewer transport can differ.

## Codex Environment

Preferred default:

- native reviewer subagents, only when they can reliably stay leaf workers

Use targeted fan-out only when needed. The main session still owns synthesis and deduplication.

If native subagents can call agent orchestration tools, consume sibling or parent mailbox updates, or launch their own review fan-out, treat native subagents as an unstable backend for that review. Prefer an isolated reviewer process or keep the review in the main session.

## Claude Environment

Preferred default:

- bounded `codex exec` reviewer workers

Useful pattern to borrow from `humanize:ask-codex`:

- bounded invocation
- explicit model / effort / timeout
- worker receives the task payload, not the whole conversation

Do not copy `humanize:ask-codex` artifact persistence as a default behavior for this skill.

## Worker Contract

Regardless of backend:

- reviewers get `review_target` and `review_goal`
- reviewers get explicit source metadata: `local_diff`, `github_pr`, `gitlab_mr`, or another source type
- reviewers get repository remote/path, base/head refs, PR/MR URL or number when available, and the exact diff source to use
- reviewers get only the supporting context needed for the requested review
- reviewers return raw findings only
- reviewers do not reply directly to the user
- reviewers do not write memory
- reviewers do not call agent orchestration tools or wait for sibling reviewers
- main session performs final synthesis

## Suggested Claude Worker Inputs

When using `codex exec`, pass only bounded review inputs such as:

- review target
- source type and host, such as `github_pr`, `gitlab_mr`, or `local_diff`
- repository remote/path, base ref, head ref, and PR/MR URL or number
- exact diff source to use, such as local `git diff origin/main...HEAD`, GitHub PR API, or GitLab MR API
- review goal
- changed files or diff
- minimal supporting context
- optional model override
- optional reasoning/effort override
- timeout bound

Avoid passing the full conversation unless the review target itself depends on it.
