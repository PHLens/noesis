# Review Templates

## Reviewer Template

Use this when launching one reviewer worker per review dimension, whether that worker is a native subagent or a `codex exec`-launched Codex reviewer.

```text
Review the current <artifact set> only for <review dimension>.

Review question:
- <one narrow question or decision boundary>

Scope:
- <targets>

Calibration:
- Only flag issues that would cause real planning, implementation, operational, or acceptance problems for <review goal>.
- Approve unless there is a serious gap, contradiction, or ambiguity that would materially derail the next step.
- Do not block on wording polish, stylistic preferences, or nice-to-have restructuring.

Verification rules:
- Review current-state artifacts only.
- Do not trust prior review summaries, patch descriptions, commit messages, or "this was already fixed" claims.
- Verify directly from the current artifact set.
- Do not repeat issues already fixed unless they are still present now.

Do not propose code changes.
Do not reply to the user directly.
Do not update memory files.
Return raw findings only to the main session.

Output format:
Status: Approved | Needs Clarification | Blocked

Blocking issues:
- <finding> — <why it matters> — <file:line>

Non-blocking notes:
- <advisory note> — <file:line>
```

## Claude To Codex Exec Hint

Use this when Claude is the main session and Codex should perform the bounded review work.

```text
Launch one `codex exec` reviewer per review dimension.

Rules:
- pass only the assigned review dimension and target artifact set
- keep the reviewer output raw and findings-first
- do not let the reviewer reply to the human directly
- collect all reviewer outputs back in the Claude main session for synthesis
- if available worker slots are limited, run the reviewers in batches instead of failing
```

## Large-Review Scoping Hint

Use this when a review target contains one top-level spec plus many split plans.

```text
Start with the smallest authoritative artifact set that can answer this review dimension.

Default starting set:
- <top-level spec>
- <coordinator or index plan>

Only add split task plans if this dimension cannot be answered from the starting set.
```

## Main-Session Synthesis Template

Use this for the final findings-first reply after collecting subagent outputs.

```text
Review status:
- Approved | Needs Clarification | Blocked

What needs human confirmation:
- <only include decisions the human actually needs to make>

Blocking findings:
- <severity>: <finding>
Location:
- <file:line>
Why it matters:
- <short reasoning>

Non-blocking notes:
- <severity>: <finding>
Location:
- <file:line>
Why it matters:
- <short reasoning>

Next step:
- <light handoff such as patch / re-review / accept as tradeoff>
```

## Override Examples

### Override Review Dimensions

```text
Use these review dimensions instead of the default profile:
1. <dimension one>
2. <dimension two>
```

### Constrain the Goal

```text
Review targets:
- <targets>

Review goal:
- Focus only on execution blockers for the current release.
```

### Disable Fan-Out

```text
Do not fan out this review.
Keep the same review dimensions, but complete the review in the main session only.
```
