# Claude / Codex Reviewer Backend Notes

The review contract stays the same across environments, but the reviewer transport can differ.

## Codex Environment

Preferred default:

- native reviewer subagents

Use targeted fan-out only when needed. The main session still owns synthesis and deduplication.

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
- reviewers get only the supporting context needed for the requested review
- reviewers return raw findings only
- reviewers do not reply directly to the user
- reviewers do not write memory
- main session performs final synthesis

## Suggested Claude Worker Inputs

When using `codex exec`, pass only bounded review inputs such as:

- review target
- review goal
- changed files or diff
- minimal supporting context
- optional model override
- optional reasoning/effort override
- timeout bound

Avoid passing the full conversation unless the review target itself depends on it.
