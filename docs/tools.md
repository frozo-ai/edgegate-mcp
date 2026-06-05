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

---

## `edgegate_compare_runs`

Diff two EdgeGate runs in the same pipeline: per-metric deltas, gate flip classification (✓→✗ regressions, ✗→✓ recoveries), per-device breakdown (when available), and an overall verdict.

**Input:**
- `workspace_id` (string, UUID, required)
- `run_id` (string, UUID, required) — the **candidate** run to evaluate
- `baseline_run_id` (string, UUID, optional) — the baseline to compare against. When omitted, auto-selects:
  1. Most recent `passed` run in the same pipeline (excluding the candidate itself)
  2. Fallback: most recent completed run in the pipeline
  3. If nothing qualifies: "NO BASELINE" response

**Returns:** Markdown with:
- Header: pipeline name, candidate run ID, baseline run ID, completion timestamps
- Commit context (branch, SHA, message) when available from the signed evidence bundle
- Metrics table: baseline value → candidate value, delta, direction (better/worse)
- Gate status table: flip classification per gate (`passing`, `**REGRESSION** ✓→✗`, `RECOVERY ✗→✓`, `still failing`)
- Per-device breakdown for matrix runs
- Overall verdict: **REGRESSION**, **IMPROVEMENT**, **NEUTRAL**, or **NO BASELINE**
- Audit trail: diff SHA-256 (signed), bundle artifact IDs for both runs

**Verdict rules:**
- REGRESSION — any gate flip ✓→✗, OR any lower-is-better metric (`inference_time_ms`, `peak_memory_mb`) increases by ≥ 25%
- IMPROVEMENT — at least one ✗→✓ gate flip with no regressions
- NEUTRAL — no significant gate or metric changes
- NO BASELINE — first run in pipeline or no eligible prior run found

**Errors:** `404` if the candidate run itself is not found.

---

## `edgegate_export_run_report`

Download a human-readable markdown report for an EdgeGate run and save it to disk.

**Input:**
- `workspace_id` (string, UUID, required)
- `run_id` (string, UUID, required)
- `output_path` (string, optional): Where to write the file. Supports `~` and relative paths. If a directory, the file is named `edgegate-run-{id-short}.md` inside it. If omitted, defaults to `./edgegate-run-{id-short}.md` in the current working directory.
- `include_diff` (boolean, default `false`): When `true`, also fetches the run-vs-baseline diff and appends a `## Run-vs-Baseline Diff` section to the report.

**Returns:** The absolute file path where the report was written, plus the first ~30 lines of the report as a preview.

**Markdown layout:**
1. Header: Run ID, pipeline name/ID, status badge, trigger, timestamps, wall clock
2. Model: artifact ID, filename, AI Hub model/job IDs
3. Metrics table (skipped for in-flight runs)
4. Gate Results table with ✓/✗ per gate and overall verdict (skipped for in-flight runs)
5. Evidence Bundle: artifact ID + download API path (skipped for in-flight runs)
6. Run-vs-Baseline Diff (only when `include_diff=true` and a diff is available)
7. Footer: `Generated by edgegate-mcp@<version> on <ISO timestamp>`

**Notes:**
- For runs that have not yet completed, the report gracefully omits the Metrics, Gate Results, and Evidence Bundle sections, replacing them with `_Run not yet complete — check back._`
- Parent directories are created automatically with `mkdir -p` semantics.
- `include_diff=true` silently omits the diff section if the backend returns `404` (first run in pipeline or diff not yet generated).

**Errors:** `404` if the run is not found.

---

## `edgegate_import_huggingface_model`

Import a public Hugging Face model that contains a pre-built ONNX file. EdgeGate downloads the file and registers it as an Artifact ready to use in `edgegate_create_pipeline`.

**Input:**
- `workspace_id` (string, UUID, required)
- `hf_repo_id` (string, required) — Hugging Face repo in `"<owner>/<name>"` format, e.g. `"microsoft/resnet-50"`
- `revision` (string, optional, default `"main"`) — branch, tag, or commit SHA to import from
- `filename` (string, optional) — specific ONNX filename; omit to let EdgeGate autodetect
- `poll_for_completion` (boolean, optional, default `true`) — when `true`, polls until the import finishes before returning
- `max_poll_seconds` (int, 1-900, optional, default `300`) — maximum time to wait when polling

**Returns (on success):** Markdown with the `artifact_id`, filename, file size, and a ready-to-copy snippet showing how to reference it in `edgegate_create_pipeline`.

**Returns (poll=false):** The `import_job_id` and current status immediately, with instructions for re-polling later.

**Returns (timeout):** Current status and `import_job_id` to re-check later; the import continues in the background.

**Errors:**
- `failed` status — returns `isError: true` with the `error_detail` (e.g. "no ONNX file found in repository"). Common causes: no pre-built ONNX in the repo, private repo, bad revision/filename.
- `402` — your plan does not include HuggingFace imports; upgrade at `https://edgegate.frozo.ai/pricing`.
- `401` — API key missing, expired, or revoked.

**v1 scope:**
- Public repos only
- ONNX files only (no optimum conversion, no LLM tokenizer wrapping)
