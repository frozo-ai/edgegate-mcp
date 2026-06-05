export type UUID = string;

export interface Workspace {
  id: UUID;
  name: string;
  /** Owner UUID — may be omitted by the API depending on response shape. */
  owner_id?: UUID;
  /** Calling user's plan tier; null/undefined when the API hasn't been
   *  updated to include it. The MCP tool renders "(unknown)" in that case. */
  plan?: string | null;
}

export interface Pipeline {
  id: UUID;
  name: string;
  device_count: number;
  model_count: number;
  gate_count: number;
  cell_count: number;
  promptpack_id: string;
  promptpack_version: string;
  created_at: string;
  updated_at: string;
  last_run: { id: UUID; status: string; created_at: string } | null;
}

export interface Gate {
  metric: string;
  operator: "<=" | "<" | ">=" | ">" | "==";
  threshold: number;
}

export interface RunSummary {
  id: UUID;
  pipeline_id: UUID;
  pipeline_name: string;
  status: "pending" | "running" | "passed" | "failed" | "error";
  trigger: string;
  model_artifact_id: UUID | null;
  model_filename: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  hub_model_id: string | null;
  hub_job_id: string | null;
}

export interface GateEvalResult {
  metric: string;
  passed: boolean;
  operator: string;
  threshold: number;
  description: string | null;
  actual_value: number;
}

export interface GatesEval {
  gates: GateEvalResult[];
  passed: boolean;
}

export interface RunDetail extends RunSummary {
  normalized_metrics: Record<string, number> | null;
  gates_eval: GatesEval | null;
  bundle_artifact_id: UUID | null;
}

export interface RunBundle {
  run_id: UUID;
  status: string;
  pipeline_id: UUID;
  pipeline_name: string;
  normalized_metrics: Record<string, number> | null;
  gates_eval: GatesEval | null;
  bundle_artifact_id: UUID | null;
}

export interface APIKeyCreateResponse {
  id: UUID;
  plaintext: string;
  name: string;
  prefix: string;
  suffix: string;
}

export interface WorkflowTemplate {
  workflow_yaml: string;
  api_url: string;
  secret_names: string[];
}

/** @deprecated Not used — audit-report endpoint does not exist; use RunBundle instead. */
export interface AuditReport {
  url?: string;
  generated_at?: string;
}

// ─── HuggingFace import types ─────────────────────────────────────────────

export type HFImportStatus =
  | "queued"
  | "downloading"
  | "uploading_to_hub"
  | "done"
  | "failed";

export interface HFImportJob {
  import_job_id: string;
  status: HFImportStatus;
  hf_repo_id?: string;
  revision?: string;
  artifact_id: string | null;
  size_bytes: number | null;
  filename: string | null;
  error_detail: string | null;
}

// ─── Compare-runs types ────────────────────────────────────────────────────

export interface MetricDelta {
  current: number | null;
  previous: number | null;
  delta: number | null;
  delta_pct: number | null;
}

export interface GateFlip {
  metric: string;
  /** "unchanged" | "improved" | "regressed" | "still_failing" | "new" | "removed" */
  transition: string;
  previous: {
    passed: boolean | null;
    threshold: number | null;
    operator: string | null;
    actual_value: number | null;
  } | null;
  current: {
    passed: boolean | null;
    threshold: number | null;
    operator: string | null;
    actual_value: number | null;
  } | null;
}

export interface RunDiffPayload {
  current_run_id: UUID;
  previous_run_id: UUID | null;
  current_commit: Record<string, string | null>;
  previous_commit: Record<string, string | null> | null;
  current_completed_at: string | null;
  previous_completed_at: string | null;
  metric_deltas: Record<string, MetricDelta>;
  gate_flips: GateFlip[];
  per_device: Record<string, Record<string, MetricDelta>> | null;
  per_cell: unknown[] | null;
  is_baseline: boolean;
}

export interface RunComparison {
  current_run_id: UUID;
  previous_run_id: UUID | null;
  diff_sha256: string | null;
  diff: RunDiffPayload;
  created_at: string;
}
