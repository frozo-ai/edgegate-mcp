---
name: edgegate-compare
description: Diff two EdgeGate runs in the same pipeline. Use when the user wants to know "what changed" between runs, "is this a regression", "compare these runs", or "show the delta vs main".
---

# /edgegate-compare

The user wants to compare two EdgeGate runs and understand the verdict.

## Steps

1. **Identify the candidate run.** If the user gave you a `run_id`, use it. If they said "the latest run" or didn't specify, call `edgegate_get_report` to list recent runs and ask which one they mean.

2. **Identify the baseline.**
   - If the user provided a `baseline_run_id`, use it.
   - Otherwise, omit the field — `edgegate_compare_runs` auto-selects the most recent PASSED run from the same pipeline (excluding the candidate). This is almost always what users want.

3. **Call `edgegate_compare_runs`** with `workspace_id`, `run_id`, and optionally `baseline_run_id`.

4. **Lead with the verdict.** The tool returns one of:
   - **REGRESSION** — at least one gate flipped ✓→✗ OR a lower-is-better metric increased by ≥ 25%. Call this out at the top. List which gates flipped and what metric jumped.
   - **IMPROVEMENT** — at least one ✗→✓ gate recovery with no regressions. Briefly highlight what got better.
   - **NEUTRAL** — no significant changes. Reassure the user the run is safe to merge.
   - **NO BASELINE** — this is the first run in the pipeline (nothing to compare against).

5. **For PR comments:** suggest the user attach the metric deltas table + verdict line. The audit trail (signed diff SHA-256) is in the response and worth including for compliance.

## Failure modes

- **404 on the candidate** — wrong `run_id`. Ask the user to double-check or call `edgegate_get_report`.
- **NO BASELINE on a pipeline that should have runs** — only one run exists in that pipeline OR the prior runs never completed. Check via `edgegate_get_report` and explain.
