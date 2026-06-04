---
name: edgegate-gate
description: Trigger an EdgeGate run on an existing pipeline. Use when the user says "run the gates" or "test this PR on devices".
---

# /edgegate-gate

The user wants to trigger an EdgeGate run.

1. If you don't know the `workspace_id`, call `edgegate_setup_workspace` first.
2. If you don't know the `pipeline_id`, ask the user. (In v1.0 there is no `list_pipelines` tool; tell them to find it in the dashboard at `https://edgegate.frozo.ai/workspace/{id}/pipelines`.)
3. Call `edgegate_run_gate` with the workspace_id + pipeline_id. Optionally accept a `model_artifact_id` override.
4. Tell the user the run_id and that they can check status with `/edgegate-status`.

If you get a 409, that means another run is already in flight (workspace_concurrency=1). Tell the user to wait for it to finish, or check status.
