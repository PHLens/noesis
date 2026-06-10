---
name: profile-regression-analysis
description: Analyze ML training performance regressions from benchmark logs, profiler CSV summaries, and large Chrome trace files. Use for PyTorch, Megatron, MLU/Cambricon, distributed training, kernel-level regression, communication-vs-compute attribution, or when a user asks where profile data shows a slowdown.
---

# Profile Regression Analysis

Use this skill to compare two ML training profile runs and attribute a
performance regression to the right layer: end-to-end training, device compute,
communication, named kernels, or profiler-unclassified compute.

## Required Inputs

- candidate run path
- baseline run path
- comparison goal, such as PyTorch version regression, kernel regression, or
  communication slowdown

If a user gives a candidate kernel name, treat it as a high-priority hypothesis
and check it directly before giving a broad answer.

## Workflow

### 1. Establish The Regression

Start with run-level evidence before kernel detail.

Prefer these files when present:

- `benchmark_log`
- `train.log`
- `testcase.json`
- `train.sh`

Compare:

- `batch_time_avg`
- `hardware_time_avg`
- `comm_time_avg`
- throughput, tokens/sec, MFU
- stable iteration windows from `train.log`

Exclude known profiling overhead iterations before computing steady-state
averages. In Megatron/CNTrainKit logs, a profiling iteration can be minutes
long in both runs and should not be treated as the training regression.

### 2. Attribute By Major Bucket

Use aggregate profiler CSVs before reading raw traces:

```text
profiler_logs/profiler_logs_iter*/cluster_aggregation/step/
  iteration_summary.csv
  percent_iteration_summary.csv
  computation_statistic.csv
  communication_statistic.csv
  computation_efficiency_bandwidth.csv
  communication_bandwidth.csv
```

Compute rank means and deltas for:

- `Device-Duration`
- `Compute-Hardware`
- `Communication`
- `Real-Communication`
- `Non-Overlapped-Communication`
- `Device-Gap`

If communication decreases or stays flat while `Compute-Hardware` increases,
state that communication is not the primary cause. Validate this with
`Real-Communication`, not only high-level `Communication`.

### 3. Do Not Stop At "Unclassified"

Profiler summary tables often expose only fixed compute categories such as
`Matmul`, `FA_Forward`, `FA_Backward`, `RoPE`, `CrossEntropy`, optimizer, and
grad accumulation. Triton pointwise/fusion kernels or runtime-generated kernels
may not appear by name in these exported CSVs.

Calculate:

```text
Other/Unclassified Compute =
  Compute-Hardware
  - sum(named compute buckets in computation_statistic.csv)
```

Use "unclassified" only as an intermediate finding. If this bucket explains the
regression, continue to raw trace or kernel-name search until either:

- a concrete kernel/event explains the delta, or
- the raw trace cannot be searched within available resources.

When reporting, say "unclassified by the exported profiler summary" rather than
implying no operator exists.

### 4. Compare Exported Op And Comm CSVs

Scan every rank:

```bash
grep -R -F -n -- "$KERNEL" "$RUN/profiler_logs"/profiler_logs_iter*/rank_*/op_grouped_by_input.csv
grep -R -F -n -- "$KERNEL" "$RUN/profiler_logs"/profiler_logs_iter*/rank_*/comm_grouped_by_input.csv
```

If the candidate kernel does not appear, it may still exist in raw
`*.pt.trace.json.gz`. CSV absence is not proof that the kernel is irrelevant.

For op CSV comparisons:

- compare by name
- compare by name plus shape
- separate call-count changes from per-call duration changes
- verify whether the op-level delta is large enough to explain the bucket delta

### 5. Search Large Chrome Traces Safely

Raw `*.pt.trace.json.gz` can be multiple gigabytes per rank when decompressed.
Avoid full JSON parsing as the first approach.

Use targeted text search:

```bash
find "$RUN/profiler_logs" -name '*.pt.trace.json.gz' -print0 |
  xargs -0 -n1 -P4 sh -c 'kernel=$1; trace=$2; zgrep -F -q -- "$kernel" "$trace" && echo "$trace"' sh "$KERNEL"
```

Count occurrences:

```bash
zgrep -F -c -- "$KERNEL" "$TRACE"
```

Extract duration for a known event name:

```bash
zgrep -F -A6 -- "\"name\": \"$KERNEL\"" "$TRACE" |
  awk '/"dur":/ {
    v=$0
    sub(/^[[:space:]]*"dur": /, "", v)
    sub(/,?[[:space:]]*$/, "", v)
    v += 0
    n++
    sum += v
    if (n == 1 || v < min) min = v
    if (v > max) max = v
  }
  END {
    printf "n=%d sum_s=%.6f avg_us=%.3f min_us=%.3f max_us=%.3f\n",
      n, sum / 1000000, sum / n, min, max
  }'
```

Chrome trace `dur` is normally in microseconds. Convert per-rank sums to
seconds. Do not sum all ranks and compare that total to step time; compare the
per-rank critical-path delta against the per-rank profiler bucket delta.

### 6. Confirm A Kernel Cause

A kernel is a strong cause when all of these hold:

- it exists in both candidate and baseline, or is newly introduced in candidate
- call counts are equal or the count delta is understood
- per-rank duration delta is close to the unexplained `Compute-Hardware` delta
- the pattern holds on multiple ranks
- the delta is not already explained by communication, memcpy, or device gap

Example interpretation:

```text
In a PyTorch 2.12 vs 2.11 Mixtral run, exported CSVs showed named compute
buckets essentially flat but Other/Unclassified Compute +4.56s/rank.
Raw trace search mapped the delta to:
triton_poi_fused_add_convert_element_type_mul_sigmoid_sub_0
The kernel appeared 8192 times per rank in both runs, but rank0 total dur grew
from 0.584s to 5.184s. The +4.600s/rank delta matched the unexplained compute
bucket, making this kernel the primary compute regression.
```

Check distribution when a few outliers could distort the average:

```bash
zgrep -F -A6 -- "\"name\": \"$KERNEL\"" "$TRACE" |
  awk '/"dur":/ {
    v=$0
    sub(/^[[:space:]]*"dur": /, "", v)
    sub(/,?[[:space:]]*$/, "", v)
    v += 0
    n++
    sum += v
    if (v > 100) gt100++
    if (v > 500) gt500++
    if (v > 1000) gt1000++
  }
  END {
    printf "n=%d sum_s=%.6f avg_us=%.3f >100us=%d >500us=%d >1000us=%d\n",
      n, sum / 1000000, sum / n, gt100, gt500, gt1000
  }'
```

### 7. Report Precisely

Lead with the answer, then evidence:

- end-to-end regression size
- major bucket attribution
- concrete kernel evidence, if found
- why other candidates are not primary causes
- environment or version differences that are plausible owners

Be explicit about evidence limits. If raw trace was not fully parsed, say so.
If a kernel is found only after a user supplies its name, correct the earlier
attribution and explain that the exported profiler CSV did not surface the
kernel name.

## Common Failure Modes

- Treating `Unclassified Compute` as final instead of a pointer to raw trace.
- Searching only `op_grouped_by_input.csv` and missing raw trace events.
- Comparing all-rank summed kernel duration to one rank's step duration.
- Blaming communication from `Communication` alone without checking
  `Real-Communication` and `Non-Overlapped-Communication`.
- Letting a profiling-overhead iteration distort steady-state iteration
  averages.
- Claiming a kernel caused the regression from call count alone without showing
  duration delta and rank consistency.
