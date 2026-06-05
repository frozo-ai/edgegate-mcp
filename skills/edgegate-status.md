---
name: edgegate-status
description: Check on an in-flight or recent EdgeGate run. Shows status, per-device metrics, gate pass/fail.
---

# /edgegate-status

The user wants to know how a run is doing.

1. If they gave you a `run_id`, call `edgegate_check_status` directly.
2. If they did NOT give you a run_id, call `edgegate_get_report` to show the last 10 runs, then ask which one they meant.
3. Render the result. If the run is FAILED, lead with the violating gate and the actual value — don't bury it.

For PASSED runs, briefly summarize the metrics so the user has the numbers handy for a PR comment.

## "Is this run a regression?"

If the user asks whether a run is a regression, or wants to see how it compares to the previous one, call `edgegate_compare_runs` with the `run_id` (and optionally a `baseline_run_id`). The tool auto-selects the baseline from the same pipeline when no explicit baseline is given. Read the **Verdict** section of the output — REGRESSION means at least one gate flipped ✓→✗ or a lower-is-better metric increased by ≥ 25%.
