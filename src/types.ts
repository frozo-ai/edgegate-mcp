export type UUID = string;

export interface Workspace {
  id: UUID;
  name: string;
  owner_id: UUID;
  plan: string;
}

export interface Pipeline {
  id: UUID;
  workspace_id: UUID;
  name: string;
  description: string | null;
  status: "active" | "paused";
  pipeline_yaml: string;
  created_at: string;
}

export interface Gate {
  metric: string;
  operator: "<=" | "<" | ">=" | ">" | "==";
  threshold: number;
}

export interface RunSummary {
  id: UUID;
  workspace_id: UUID;
  pipeline_id: UUID;
  status: "pending" | "running" | "passed" | "failed" | "error";
  started_at: string | null;
  completed_at: string | null;
  trigger: string;
}

export interface RunCell {
  model_artifact_id: UUID;
  device_name: string;
  metrics: Record<string, number>;
  gate_results: Array<{ metric: string; passed: boolean; threshold: number; actual: number }>;
}

export interface RunDetail extends RunSummary {
  cells: RunCell[];
  evidence_bundle_url: string | null;
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

export interface AuditReport {
  url: string;
  generated_at: string;
}
