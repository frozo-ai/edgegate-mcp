export type UUID = string;

// ─── InputSpec types ───────────────────────────────────────────────────────

/** Supported dtypes for AI Hub compile input tensors. */
export type InputSpecDtype = "float32" | "float16" | "int64" | "int32" | "bool";

/**
 * Explicit shape + dtype for one named model input.
 * Passed as `input_specs` on pipeline create/update to override the default
 * AI Hub auto-detect or PR-#40 auto-resolve behaviour.
 *
 * Example (BERT-family):
 *   { shape: [1, 128], dtype: "int64" }
 */
export interface InputSpec {
  /** Tensor shape (1–8 positive integers). */
  shape: number[];
  /** Element dtype. Defaults to "float32" when omitted. */
  dtype: InputSpecDtype;
}

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

// ─── HuggingFace integration types ────────────────────────────────────────

/**
 * Returned by GET /integrations/huggingface — status without the token.
 * The plaintext token is never echoed; only the last 4 chars + lifecycle
 * fields are visible after the initial connect/rotate call.
 */
export interface HuggingFaceIntegrationStatus {
  id: UUID;
  provider: "huggingface";
  status: "active" | "disabled";
  token_last4: string;
  created_at: string;
  updated_at: string;
}

/**
 * Returned by POST /integrations/huggingface and the rotate endpoint.
 * Includes the whoami account name/type so the caller can confirm the
 * right account was connected, without leaking the secret.
 */
export interface HuggingFaceConnectResponse extends HuggingFaceIntegrationStatus {
  account_name: string;
  account_type: string;
}

// ─── Qualcomm AI Hub integration types ────────────────────────────────────

/**
 * Returned by GET / POST / PUT on /integrations/qaihub.
 * The plaintext token is never echoed; only token_last4 is visible.
 */
export interface QaihubIntegration {
  id: UUID;
  provider: "qaihub";
  status: "active" | "disabled";
  token_last4: string;
  created_at: string;
  updated_at: string;
}

// ─── API key management types ─────────────────────────────────────────────

/**
 * Returned by POST /workspaces/{ws}/api-keys.
 * `plaintext` is the only time the full key is visible — the caller must
 * persist it immediately; the backend stores only a bcrypt hash.
 */
export interface APIKeyCreatedResponse {
  id: UUID;
  plaintext: string;
  name: string;
  prefix: string;
  suffix: string;
  created_at: string;
  expires_at: string | null;
}

/**
 * Returned by GET /workspaces/{ws}/api-keys (one row per key).
 * Includes lifecycle fields but never the plaintext or the hash.
 */
export interface APIKeyListItem {
  id: UUID;
  name: string;
  prefix: string;
  suffix: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// ─── Workspace + member management types ──────────────────────────────────

export type WorkspaceRole = "owner" | "admin" | "viewer";

export interface Member {
  user_id: UUID;
  email: string;
  role: WorkspaceRole;
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

// ─── PromptPack types ──────────────────────────────────────────────────────

export interface PromptPackSummary {
  id: UUID;
  promptpack_id: string;
  version: string;
  sha256: string;
  case_count: number;
  published: boolean;
  created_at: string;
}

export interface PromptPackExpected {
  type: "none" | "exact" | "regex" | "json_schema";
  text?: string;
  pattern?: string;
  schema?: Record<string, unknown>;
}

export interface PromptPackDefaults {
  max_new_tokens?: number;
  temperature?: number;
  top_p?: number;
  seed?: number;
}

export interface PromptPackCase {
  case_id: string;
  name: string;
  prompt: string;
  expected?: PromptPackExpected;
  overrides?: PromptPackDefaults;
}

export interface PromptPackContent {
  promptpack_id: string;
  version: string;
  name: string;
  description?: string;
  tags?: string[];
  defaults?: PromptPackDefaults;
  cases: PromptPackCase[];
}

export interface PromptPackCreateBody {
  promptpack_id: string;
  version: string;
  content: PromptPackContent;
}

// ─── BYO storage (Enterprise) types ───────────────────────────────────────

/**
 * Workspace's customer-owned S3 bucket grant. Returned by every grant
 * endpoint (register / get / verify / rotate-external-id).
 *
 * `external_id` is shown in EVERY response — it's the value the customer
 * has to paste into their IAM role trust policy's `sts:ExternalId`
 * condition. We don't treat it like a secret because the trust policy
 * already pins our AWS account as the only principal that can use it.
 *
 * `status` semantics: "active" = last probe passed; "failed" = last probe
 * raised (with `last_verify_error` populated); "revoked" = grant was
 * explicitly deleted (404 on /grants thereafter).
 */
export interface ByoGrant {
  id: UUID;
  workspace_id: UUID;
  role_arn: string;
  external_id: UUID;
  bucket: string;
  region: string;
  kms_key_id: string | null;
  status: "active" | "revoked" | "failed";
  last_verified_at: string | null;
  last_verify_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Request body for POST /v1/workspaces/{ws}/artifacts/byo.
 * Registers an existing S3 URI in the customer's grant-registered bucket
 * as an Artifact pointer. EdgeGate does NOT upload bytes — it HeadObjects
 * the URI to confirm existence + capture size/etag.
 */
export interface ByoArtifactRegisterRequest {
  s3_uri: string;
  expected_sha256?: string;
  expected_size?: number;
  kind?: string;
  original_filename?: string;
}

/**
 * One row from the workspace's append-only `byo_storage_audit` table.
 * `aws_request_id` is the join key for cross-referencing the customer's
 * own CloudTrail. Nullable fields are by design for events that don't
 * produce them (verify_probe has no run_id/artifact_id, etc.).
 */
export interface ByoAuditEntry {
  id: number;
  event_type: string;
  aws_request_id: string;
  role_arn: string;
  bucket: string;
  s3_key: string | null;
  bytes_read: number | null;
  worker_hostname: string | null;
  outcome: string;
  error_code: string | null;
  artifact_id: UUID | null;
  run_id: UUID | null;
  ts: string;
}

/**
 * Paginated audit-log page. `next_cursor === null` means the response
 * contained the last page. Pass the value back as the `cursor` query
 * param to fetch the next page.
 */
export interface ByoAuditPage {
  entries: ByoAuditEntry[];
  next_cursor: number | null;
}

/**
 * Returned by POST /artifacts and POST /artifacts/byo. Mirrors the
 * backend `ArtifactResponse` schema. `storage_url` for BYO artifacts is
 * `byo-s3://{bucket}/{key}` rather than the managed `s3://...` form.
 */
export interface ArtifactResponse {
  id: UUID;
  kind: string;
  sha256: string;
  size_bytes: number;
  original_filename: string | null;
  storage_url: string;
  created_at: string;
  expires_at: string | null;
}
