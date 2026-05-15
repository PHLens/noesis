# Default Code Review Profile

Use this profile unless the caller explicitly requests a narrower or different code-review goal.

## Primary Review Dimensions

### 1. Bug / Regression Risk

Look for:

- broken logic
- changed behavior without protection
- incorrect edge-case handling
- invalid assumptions introduced by the diff

### 2. Interface / Boundary / Data Contract Risk

Look for:

- mismatched DTOs or shapes
- broken call contracts
- drift between callers and callees
- leaked internals across boundaries

### 3. Testing Gaps

Look for:

- missing tests for changed behavior
- tests that do not actually cover the risky path
- missing regression protection for the new failure mode

### 4. Side-Effect / Ops / Migration Risk

Look for:

- state changes with no rollback or guard
- runtime side effects not reflected in reviewability
- schema, config, or environment assumptions
- dangerous behavior under real execution conditions

## Secondary Concerns

These may appear as advisory notes, but should not dominate the output by default:

- style
- refactor opportunities
- abstraction preferences
- speculative redesign suggestions

## Status Calibration

### Approved

Use when no material issues were found for the requested review goal.

### Needs Fixes

Use when there are real issues, but the change set is reviewable and the path to repair is clear.

### Blocked

Use when:

- there is a severe correctness or release risk
- the review target is not actually reviewable yet
- the request is mis-scoped or missing critical setup

## Severity Calibration

### High

Likely bug, regression, or release blocker.

### Medium

Real problem worth fixing before approval, but not immediately catastrophic.

### Low

Concrete but lower-risk issue or cleanup item.

If severity is uncertain, downgrade it.

## Not This Skill

If the request is mainly:

- spec compliance
- architecture document review
- plan completeness
- RFC or PRD review

Redirect to `doc-review`.
