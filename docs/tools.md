# EdgeGate MCP — Tool Reference

All tools require `EDGEGATE_API_KEY` to be set in the MCP server's environment. Generate one at `https://edgegate.frozo.ai/workspace/<id>/settings#api-keys`.

## `edgegate_setup_workspace`

Confirm or list workspaces. Run this first in a fresh conversation.

**Input:**
- `workspace_id` (string, optional, UUID): If given, confirms this specific workspace. If omitted, lists all.

**Returns:** Markdown listing the workspaces or confirming the active one.

---

## `edgegate_create_pipeline`

Define a new EdgeGate regression pipeline.

**Input:**
- `workspace_id` (string, UUID, required)
- `name` (string, required, ≤ 255 chars)
- `description` (string, optional)
- `models` (array of `{name, artifact_id}`, 1-10 entries)
- `devices` (array of strings, 1-5 entries — must be valid AI Hub device names)
- `gates` (array of `{metric, operator, threshold}`, ≥ 1 entry)
  - `metric`: one of `inference_time_ms`, `peak_memory_mb`, `throughput_tps`
  - `operator`: one of `<=`, `<`, `>=`, `>`, `==`
  - `threshold`: positive number
- `promptpack_id` (string, UUID, optional)
- `repeats` (int, 1-5, optional)

**Constraint:** `models.length * devices.length ≤ 25` (M × D cell limit). Enforced client-side and server-side.

**Returns:** Markdown confirming the pipeline was created, including the new `pipeline_id`.

---

## `edgegate_run_gate`

Trigger a run against an existing pipeline.

**Input:**
- `workspace_id` (string, UUID, required)
- `pipeline_id` (string, UUID, required)
- `model_artifact_id` (string, UUID, optional): override the pipeline's default model

**Returns:** Markdown with the new `run_id` and next-step instructions.

**Errors:** `409` means another run is already in flight (workspace_concurrency=1).

---

## `edgegate_check_status`

Poll a run for status, per-device metrics, and gate pass/fail.

**Input:**
- `workspace_id` (string, UUID, required)
- `run_id` (string, UUID, required)

**Returns:** Markdown with status badge (PASSED/FAILED/PENDING/RUNNING/ERROR), per-device metrics, gate results, and (if completed) the evidence bundle URL.

---

## `edgegate_get_report`

List recent runs in a workspace.

**Input:**
- `workspace_id` (string, UUID, required)
- `limit` (int, 1-50, default 10)

**Returns:** Markdown table with run_id, status, trigger, duration, started_at.

---

## `edgegate_get_audit_report`

Get the signed audit PDF URL for a completed run.

**Input:**
- `workspace_id` (string, UUID, required)
- `run_id` (string, UUID, required)

**Returns:** Markdown with the signed (time-limited) URL and generation timestamp.

**Errors:** `404` means the report hasn't been generated yet (async, ~1-2 min after run completion).

---

## `edgegate_setup_github_action`

Generate the GitHub Actions workflow YAML + the `gh secret set` commands the user must run.

**Input:**
- `workspace_id` (string, UUID, required)
- `pipeline_id` (string, UUID, optional)
- `model_artifact_id` (string, UUID, optional)

**Returns:** Markdown containing:
1. The YAML to write to `.github/workflows/edgegate.yml`
2. A code block with the `gh secret set ...` commands the user must run
3. A link to the dashboard for generating `EDGEGATE_API_SECRET`
