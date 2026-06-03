# Slock Collaboration Defaults (Optional Environment Profile)

Use this reference only when the skill is running inside the current Slock-style collaboration environment, or another environment with very similar task-thread, main-session, and memory responsibilities.

If the skill is being used from Claude or another runtime without this exact collaboration model, keep the core workflow from `SKILL.md` and ignore or adapt this file as needed.

## Default Collaboration Rules

- The main session is the only agent that replies to the human.
- Reviewer workers return raw findings only to the main session.
- Reviewer workers do not update memory files.
- The main session owns:
  - deduplication
  - severity judgment
  - user-facing synthesis
  - durable-memory updates
  - the decision to patch docs after review

## Default Reviewer Backend Policy

- In Codex main sessions, native reviewer subagents are acceptable only when they can reliably stay leaf workers.
- In Claude main sessions, prefer launching Codex reviewer workers through `codex exec` rather than Claude-native subagents.
- If reviewer workers can call agent orchestration tools, consume sibling or parent mailbox updates, or recurse into review orchestration, treat that backend as unstable for this review.
- Keep Claude as the orchestration layer:
  - define review boundaries
  - choose the reviewer file sets
  - collect raw outputs
  - synthesize and reply

## Default Reviewer Quality Policy

- Give each reviewer one narrow review question or decision boundary.
- Default to approval unless there is a real planning, implementation, runtime, or acceptance problem.
- Reviewers must verify the current artifact set directly.
  - Do not trust prior summaries.
  - Do not trust commit descriptions or patch notes.
  - Do not trust "already fixed" claims without checking the current files.
- Prefer a status-first reviewer output:
  - `Approved`
  - `Needs Clarification`
  - `Blocked`
- Put blocking issues ahead of advisory notes.
- When the human has low review bandwidth, the main session should compress the result to the few decisions that actually require human confirmation.

## Default Fan-Out Policy

- Default to one reviewer worker per review dimension.
- For large artifact sets, start each reviewer with the smallest authoritative set that can answer the dimension.
  - Default starting point for split-plan reviews:
    - top-level spec
    - coordinator/index implementation plan
  - Add split task plans only when the dimension still needs more detail.
- Reviewer concurrency should respect available worker or thread slots.
  - Effective reviewer concurrency should be `min(review_dimensions, available_worker_slots)`.
  - If slots are insufficient, queue or batch the remaining reviewers instead of failing the review.
- Fall back to main-session-only review when:
  - the task is too small to justify fan-out
  - the reviewer backend is unstable
  - the review dimensions are too tightly coupled to split cleanly
- If the user explicitly forbids fallback and the backend is unstable, stop and report the infrastructure failure instead of completing the review in the main session.

## Default Wait And Fallback Policy

- First wait window: `120s`
- If reviewers are still running, second wait window: `180s`
- If reviewers still do not return final results after about `5 minutes` total, treat that as a stalled review run
- On stall:
  - close the reviewer workers
  - keep the same review dimensions
  - complete the review in the main session
- If a reviewer violates the leaf boundary, discard that worker output and handle the run as backend instability.
- Do not wait indefinitely just because reviewers are still marked running
- Do not skip directly to fallback after one short wait unless the infrastructure is clearly broken

## Default Model Policy

- For boundary-defined review subagents, default to `gpt-5.4` with `high` reasoning effort unless the user explicitly requests something else.

## Default Output Policy

- Findings-first synthesis
- One unified reply from the main session
- Light next-step handoff by default
- Patch planning only when explicitly requested or clearly needed as a separate step
