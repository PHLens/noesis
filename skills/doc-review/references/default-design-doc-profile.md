# Default Design/Doc Review Profile

Use this default profile unless the user overrides the review dimensions.

## Default Review Dimensions

1. Architecture boundary consistency
   - layer ownership
   - responsibility leakage
   - command/use-case alignment
   - normalized-model usage
2. Dependency and parallelism realism
   - hidden dependencies
   - merge-wave realism
   - task ownership overlap
   - whether the documented contracts are sufficient for parallel execution
3. Config, safety, runtime, and acceptance gates
   - required vs safe-default config
   - local-only vs exchange-backed runtime paths
   - credential requirements
   - operator acceptance vs code-delivery boundaries

## Override Rule

If the user provides custom review dimensions, prefer those over this default set.

## Scope Note

This profile is tuned for non-code artifacts such as:

- design docs
- specs
- plans
- PRDs
- RFCs

It is not the code-review profile.
