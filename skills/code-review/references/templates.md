# Templates

## Default Reviewer Prompt

Use this to brief a reviewer worker:

```text
You are reviewing a bounded code change.

Review target:
{REVIEW_TARGET}

Review goal:
{REVIEW_GOAL}

Context boundaries:
- Review the change set first
- Only use the supporting context provided
- Do not review the whole repo unless explicitly asked
- Do not rely on session-history summaries without checking the code

Primary dimensions:
- bug/regression risk
- interface/boundary/data contract risk
- testing gaps
- side-effect/ops/migration risk

Evidence rules:
- Prefer file/line or diff-scoped evidence
- If evidence is weak, downgrade the concern
- Avoid style-only nitpicks unless they hide a real risk

Output:
- Return raw findings only
- Do not reply to the user
- Do not write memory
- Do not fix code
- Include a suggested overall status: Approved, Needs Fixes, or Blocked
```

## Default Synthesis Template

```markdown
## Code Review

**Status:** Approved | Needs Fixes | Blocked

**Findings:**
- [High|Medium|Low] Title — evidence; why it matters; short repair hint

**Open Questions / Assumptions:**
- only when needed

**Next Step:**
- one short repair or release recommendation
```

## Override Examples

### Example: Runtime-Sensitive Review

Use this when the caller mainly wants runtime-risk review:

```text
Override emphasis:
- prioritize side effects, runtime behavior, failure handling, and rollback risk
- keep style and refactor notes minimal
```

### Example: Testing-Focused Review

Use this when the caller wants to know whether tests are sufficient:

```text
Override emphasis:
- prioritize changed behavior coverage
- identify missing regression tests
- call out tests that appear to pass without covering the risky path
```

### Example: Inline-Comment-Ready Output

Use this only when the caller explicitly wants comment-ready formatting:

```text
Output mode override:
- keep the same findings
- format each finding so it can be translated into an inline review comment
- still produce one final overall status
```
