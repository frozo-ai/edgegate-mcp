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
- `promptpack_id` (string, required) — the string promptpack identifier, e.g. `"image-classification-bench-v1"`. List your packs at `GET /v1/workspaces/{id}/promptpacks`.
- `promptpack_version` (string, default `"1.0.0"`) — version string of the promptpack.
- `devices` (array of strings, 1-5 entries — must be valid AI Hub device names, e.g. `"Samsung Galaxy S24 (Family)"`)
- `gates` (array of `{metric, operator, threshold, description?}`, ≥ 1 entry)
  - `metric`: one of `inference_time_ms`, `peak_memory_mb`, `throughput_tps`
  - `operator`: one of `<=`, `<`, `>=`, `>`, `==` (translated internally to API enum `lte|lt|gte|gt|eq`)
  - `threshold`: positive number
- `models` (array of `{name, artifact_id}`, 1-10 entries, **optional**) — omit for single-model mode where the model artifact is supplied per-run to `edgegate_run_gate`.
- `repeats` (int, 1-5, optional) — measurement repeats per cell (default: 3).

**Constraint:** When `models` is provided, `models.length * devices.length ≤ 25` (M × D cell limit).

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

**Returns:** Markdown with status badge (PASSED/FAILED/PENDING/RUNNING/ERROR), normalized metrics, gate pass/fail decisions, and (if completed) the evidence bundle artifact ID.

---

## `edgegate_get_report`

List recent runs in a workspace.

**Input:**
- `workspace_id` (string, UUID, required)
- `limit` (int, 1-50, default 10)

**Returns:** Markdown table with run_id, status, trigger, duration, started_at.

---

## `edgegate_get_audit_report`

Get the evidence bundle details for a completed run (metrics, gate decisions, bundle artifact ID).

**Input:**
- `workspace_id` (string, UUID, required)
- `run_id` (string, UUID, required)

**Returns:** Markdown with the bundle artifact ID, normalized metrics, gate pass/fail decisions, and a summary of the overall verdict.

**Errors:** `404` — bundle not yet generated (async, ~1-2 min after run completion). `409` — run has not yet reached a terminal state; check with `edgegate_check_status` first.

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
