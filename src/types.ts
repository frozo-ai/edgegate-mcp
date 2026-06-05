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
