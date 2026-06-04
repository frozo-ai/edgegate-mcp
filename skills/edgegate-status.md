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
