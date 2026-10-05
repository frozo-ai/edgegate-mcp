---
name: edgegate-compare
description: Diff two EdgeGate runs from the same pipeline or matching Behavioral-Gate configuration. Use when the user wants to know "what changed" between runs, "is this a regression", "compare these runs", or "show the delta vs main".
---

# /edgegate-compare

The user wants to compare two EdgeGate runs and understand the verdict.

## Steps

1. **Identify the candidate run.** If the user gave you a `run_id`, use it. If they said "the latest run" or didn't specify, call `edgegate_get_report` to list recent runs and ask which one they mean.

2. **Identify the baseline.**
   - If the user provided a `baseline_run_id`, use it.
   - For Behavioral-Gate runs without a pipeline, supply an explicit baseline from the same eval-set, execution backend, and gate/reference configuration. Null pipeline IDs do not identify related runs.
   - Otherwise, omit the field — `edgegate_compare_runs` auto-selects the most recent PASSED run from the same pipeline (excluding the candidate). This is almost always what users want.

3. **Call `edgegate_compare_runs`** with `workspace_id`, `run_id`, and optionally `baseline_run_id`.

4. **Lead with the verdict.** The tool returns one of:
   - **REGRESSION** — at least one gate flipped ✓→✗ OR a lower-is-better metric increased by ≥ 25%. Call this out at the top. List which gates flipped and what metric jumped.
   - **IMPROVEMENT** — at least one ✗→✓ gate recovery with no regressions. Briefly highlight what got better.
   - **NEUTRAL** — no detected gate regression or recovery; for Behavioral-Gate runs, only hard-signal changes determine the verdict. Soft failures remain advisory. NEUTRAL does not establish that the run is safe to merge or that all gates pass.
   - **NO BASELINE** — no baseline was found, or a run without a pipeline needs an explicit baseline.
   - **NOT COMPARABLE** — evidence types, eval-set, backend, gate configuration, or reference values differ. Select compatible runs.
   - **INSUFFICIENT EVIDENCE** — a run is unfinished, errored, or lacks supported outcome evidence. Do not call it neutral, passing, or safe.

5. **Respect the audit scope.** Client-side comparisons, including Behavioral-Gate comparisons, are unsigned derived reports; do not describe them as signed diffs or independently verified signatures.

6. **For PR comments:** suggest the user attach the metric deltas table + verdict line. Include the audit trail and preserve whether the diff is a backend-provided signed artifact or an unsigned client-side comparison.

## Failure modes

- **404 on the candidate** — wrong `run_id`. Ask the user to double-check or call `edgegate_get_report`.
- **NO BASELINE on a pipeline that should have runs** — only one run exists in that pipeline OR the prior runs never completed. Check via `edgegate_get_report` and explain.
