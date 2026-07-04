import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EdgeGateClient } from "./client.js";
import { VERSION } from "./version.js";

import { setupWorkspaceHandler, setupWorkspaceInputSchema } from "./tools/setup_workspace.js";
import { createPipelineHandler, createPipelineInputSchema } from "./tools/create_pipeline.js";
import { runGateHandler, runGateInputSchema } from "./tools/run_gate.js";
import { checkStatusHandler, checkStatusInputSchema } from "./tools/check_status.js";
import { getReportHandler, getReportInputSchema } from "./tools/get_report.js";
import { getAuditReportHandler, getAuditReportInputSchema } from "./tools/get_audit_report.js";
import {
  setupGithubActionHandler,
  setupGithubActionInputSchema,
} from "./tools/setup_github_action.js";
import {
  compareRunsHandler,
  compareRunsInputSchema,
} from "./tools/compare_runs.js";
import {
  exportRunReportHandler,
  exportRunReportInputSchema,
} from "./tools/export_run_report.js";
import {
  importHuggingfaceModelHandler,
  importHuggingfaceModelInputSchema,
} from "./tools/import_huggingface_model.js";
import {
  predictNpuCoverageHandler,
  predictNpuCoverageInputSchema,
} from "./tools/predict_npu_coverage.js";
import {
  listPromptpacksHandler,
  listPromptpacksInputSchema,
} from "./tools/list_promptpacks.js";
import {
  createPromptpackHandler,
  createPromptpackInputSchema,
} from "./tools/create_promptpack.js";
import {
  publishPromptpackHandler,
  publishPromptpackInputSchema,
} from "./tools/publish_promptpack.js";
import {
  connectHuggingfaceHandler,
  connectHuggingfaceInputSchema,
} from "./tools/connect_huggingface.js";
import {
  disconnectHuggingfaceHandler,
  disconnectHuggingfaceInputSchema,
} from "./tools/disconnect_huggingface.js";
import {
  getHuggingfaceIntegrationHandler,
  getHuggingfaceIntegrationInputSchema,
} from "./tools/get_huggingface_integration.js";
import {
  connectQaihubHandler,
  connectQaihubInputSchema,
} from "./tools/connect_qaihub.js";
import {
  getQaihubIntegrationHandler,
  getQaihubIntegrationInputSchema,
} from "./tools/get_qaihub_integration.js";
import {
  disconnectQaihubHandler,
  disconnectQaihubInputSchema,
} from "./tools/disconnect_qaihub.js";
import {
  createWorkspaceHandler,
  createWorkspaceInputSchema,
} from "./tools/create_workspace.js";
import {
  listApiKeysHandler,
  listApiKeysInputSchema,
} from "./tools/list_api_keys.js";
import {
  createApiKeyHandler,
  createApiKeyInputSchema,
} from "./tools/create_api_key.js";
import {
  revokeApiKeyHandler,
  revokeApiKeyInputSchema,
} from "./tools/revoke_api_key.js";
import {
  listMembersHandler,
  listMembersInputSchema,
} from "./tools/list_members.js";
import {
  listDevicesHandler,
  listDevicesInputSchema,
} from "./tools/list_devices.js";
import {
  listDeviceTargetsHandler,
  listDeviceTargetsInputSchema,
} from "./tools/list_device_targets.js";
import {
  runDeviceBenchmarkHandler,
  runDeviceBenchmarkInputSchema,
} from "./tools/run_device_benchmark.js";
import {
  inviteMemberHandler,
  inviteMemberInputSchema,
} from "./tools/invite_member.js";
import {
  changeMemberRoleHandler,
  changeMemberRoleInputSchema,
} from "./tools/change_member_role.js";
import {
  removeMemberHandler,
  removeMemberInputSchema,
} from "./tools/remove_member.js";
import {
  registerByoBucketHandler,
  registerByoBucketInputSchema,
} from "./tools/register_byo_bucket.js";
import {
  setupByoStorageHandler,
  setupByoStorageInputSchema,
} from "./tools/setup_byo_storage.js";
import {
  attachByoRoleHandler,
  attachByoRoleInputSchema,
} from "./tools/attach_byo_role.js";
import {
  checkByoBucketHandler,
  checkByoBucketInputSchema,
} from "./tools/check_byo_bucket.js";
import {
  registerByoArtifactHandler,
  registerByoArtifactInputSchema,
} from "./tools/register_byo_artifact.js";
import {
  disconnectByoBucketHandler,
  disconnectByoBucketInputSchema,
} from "./tools/disconnect_byo_bucket.js";
import {
  getByoAuditHandler,
  getByoAuditInputSchema,
} from "./tools/get_byo_audit.js";
import {
  llmCompileHandler,
  llmCompileInputSchema,
} from "./tools/llm_compile.js";
import {
  checkLLMCompileStatusHandler,
  checkLLMCompileStatusInputSchema,
} from "./tools/check_llm_compile_status.js";
import {
  listEvalPacksHandler,
  listEvalPacksInputSchema,
} from "./tools/list_eval_packs.js";
import {
  createEvalSetHandler,
  createEvalSetInputSchema,
} from "./tools/create_eval_set.js";
import {
  listEvalSetsHandler,
  listEvalSetsInputSchema,
} from "./tools/list_eval_sets.js";
import {
  updateEvalSetHandler,
  updateEvalSetInputSchema,
} from "./tools/update_eval_set.js";
import {
  publishEvalSetHandler,
  publishEvalSetInputSchema,
} from "./tools/publish_eval_set.js";
import {
  newEvalSetVersionHandler,
  newEvalSetVersionInputSchema,
} from "./tools/new_eval_set_version.js";
import {
  captureReferenceHandler,
  captureReferenceInputSchema,
} from "./tools/capture_reference.js";
import {
  checkReferenceCaptureStatusHandler,
  checkReferenceCaptureStatusInputSchema,
} from "./tools/check_reference_capture_status.js";
import {
  compileGenieHandler,
  compileGenieInputSchema,
} from "./tools/compile_genie.js";
import {
  checkGenieCompileStatusHandler,
  checkGenieCompileStatusInputSchema,
} from "./tools/check_genie_compile_status.js";
import {
  createBgRunHandler,
  createBgRunInputSchema,
} from "./tools/create_bg_run.js";
import { cancelRunHandler, cancelRunInputSchema } from "./tools/cancel_run.js";
import { rerunBgHandler, rerunBgInputSchema } from "./tools/rerun_bg.js";
import {
  setupBgGithubActionHandler,
  setupBgGithubActionInputSchema,
} from "./tools/setup_bg_github_action.js";
import {
  exportComplianceReportHandler,
  exportComplianceReportInputSchema,
} from "./tools/export_compliance_report.js";

const TOOLS = [
  {
    name: "edgegate_setup_workspace",
    description:
      "Confirm or list EdgeGate workspaces visible to the API key. Run this first " +
      "in a fresh conversation to lock in which workspace_id the other tools should use.",
    schema: setupWorkspaceInputSchema,
    handler: setupWorkspaceHandler,
  },
  {
    name: "edgegate_create_pipeline",
    description:
      "Create a new EdgeGate regression pipeline. Define which model(s), which device(s), " +
      "and which gates (e.g. inference_time_ms ≤ 10) the pipeline will enforce. " +
      "For LLMs: set llm_compile_source on a model instead of artifact_id. EdgeGate will " +
      "compile + link via AI Hub on first run; subsequent runs reuse the cached composite. " +
      "ttft_ms + tps gates work; both are derived from per-component profile (prompt-role " +
      "inference_time → TTFT; 1000/token-role inference_time → TPS). Each LLM gate run = " +
      "3 AI Hub profile jobs (one per component) ≈ 3× CV cost.",
    schema: createPipelineInputSchema,
    handler: createPipelineHandler,
  },
  {
    name: "edgegate_run_gate",
    description:
      "Trigger an EdgeGate run against a pipeline. Returns a run_id you can poll with " +
      "edgegate_check_status.",
    schema: runGateInputSchema,
    handler: runGateHandler,
  },
  {
    name: "edgegate_check_status",
    description:
      "Get the current status of an EdgeGate run, including per-device metrics and " +
      "which gates passed or failed.",
    schema: checkStatusInputSchema,
    handler: checkStatusHandler,
  },
  {
    name: "edgegate_get_report",
    description: "List recent EdgeGate runs in a workspace with status, duration, and trigger.",
    schema: getReportInputSchema,
    handler: getReportHandler,
  },
  {
    name: "edgegate_get_audit_report",
    description:
      "Get the signed audit report PDF URL for a completed EdgeGate run. Used for " +
      "compliance records.",
    schema: getAuditReportInputSchema,
    handler: getAuditReportHandler,
  },
  {
    name: "edgegate_setup_github_action",
    description:
      "Generate the GitHub Actions workflow YAML + gh secret commands so every PR runs " +
      "EdgeGate as a CI gate.",
    schema: setupGithubActionInputSchema,
    handler: setupGithubActionHandler,
  },
  {
    name: "edgegate_compare_runs",
    description:
      "Diff two EdgeGate runs in the same pipeline — metrics delta, gate flips (✓→✗ regressions " +
      "and ✗→✓ recoveries), per-device breakdown, and an overall verdict (REGRESSION / IMPROVEMENT / " +
      "NEUTRAL / NO BASELINE). When baseline_run_id is omitted, auto-selects the most recent " +
      "PASSED run from the same pipeline as the baseline.",
    schema: compareRunsInputSchema,
    handler: compareRunsHandler,
  },
  {
    name: "edgegate_export_run_report",
    description:
      "Download a human-readable markdown report for an EdgeGate run and save it to disk. " +
      "Returns the absolute file path plus a preview of the first 30 lines. " +
      "Optionally includes a run-vs-baseline diff section (include_diff=true).",
    schema: exportRunReportInputSchema,
    handler: exportRunReportHandler,
  },
  {
    name: "edgegate_import_huggingface_model",
    description:
      "Import a public Hugging Face model that contains a pre-built ONNX file. EdgeGate " +
      "downloads the file and registers it as an Artifact. Returns the artifact_id you can " +
      "pass directly to edgegate_create_pipeline. Polls until the import completes by default " +
      "(poll_for_completion=true); set to false to return immediately with the job id.",
    schema: importHuggingfaceModelInputSchema,
    handler: importHuggingfaceModelHandler,
  },
  {
    name: "edgegate_predict_npu_coverage",
    description:
      "Predict which ONNX ops will run on the Qualcomm Hexagon NPU vs fall back to CPU, " +
      "BEFORE spending any AI Hub credits. Returns a compute-weighted NPU coverage % (the " +
      "latency-honest number), op-count coverage, risk band, per-op CPU fallbacks, and fix " +
      "recommendations. Heuristic — the real device run remains authoritative.",
    schema: predictNpuCoverageInputSchema,
    handler: predictNpuCoverageHandler,
  },
  {
    name: "edgegate_list_promptpacks",
    description:
      "List all promptpacks in an EdgeGate workspace. Returns a markdown table with " +
      "promptpack_id, version, case count, published status, and creation date. " +
      "Use include_unpublished=false to hide draft packs.",
    schema: listPromptpacksInputSchema,
    handler: listPromptpacksHandler,
  },
  {
    name: "edgegate_create_promptpack",
    description:
      "Create a new promptpack in an EdgeGate workspace. A promptpack defines the test " +
      "cases (prompts, expected outputs, per-case overrides) that regression pipelines " +
      "evaluate. Requires admin role on the workspace. Packs are immutable after creation — " +
      "bump the version to update.",
    schema: createPromptpackInputSchema,
    handler: createPromptpackHandler,
  },
  {
    name: "edgegate_publish_promptpack",
    description:
      "Publish a promptpack version in an EdgeGate workspace so it can be referenced in " +
      "pipelines. Newly created packs start as unpublished — call this after " +
      "edgegate_create_promptpack to complete the create → publish → use lifecycle. " +
      "Requires admin role on the workspace. The operation is idempotent.",
    schema: publishPromptpackInputSchema,
    handler: publishPromptpackHandler,
  },
  {
    name: "edgegate_connect_huggingface",
    description:
      "Store a personal HuggingFace access token for this workspace so the import flow " +
      "can read private / gated / Qualcomm-org repos (most qualcomm/*, Intel/*, and many " +
      "Xenova/* repos 401 the anonymous endpoint). The token is validated against HF " +
      "whoami before encryption and is never echoed in plaintext. If an integration " +
      "already exists this tool rotates the token. Requires admin role.",
    schema: connectHuggingfaceInputSchema,
    handler: connectHuggingfaceHandler,
  },
  {
    name: "edgegate_get_huggingface_integration",
    description:
      "Show whether a personal HuggingFace token is connected to this workspace (and " +
      "whether it is currently active or disabled). Does not return the token itself.",
    schema: getHuggingfaceIntegrationInputSchema,
    handler: getHuggingfaceIntegrationHandler,
  },
  {
    name: "edgegate_disconnect_huggingface",
    description:
      "Permanently delete the workspace's HuggingFace integration. Future HF imports fall " +
      "back to anonymous access. Requires owner role.",
    schema: disconnectHuggingfaceInputSchema,
    handler: disconnectHuggingfaceHandler,
  },
  {
    name: "edgegate_connect_qaihub",
    description:
      "Store a Qualcomm AI Hub API token for this workspace so EdgeGate can submit " +
      "compile + profile jobs on real Snapdragon devices. The token is encrypted at " +
      "rest and is never returned in plaintext after the initial connect. If an " +
      "integration already exists this tool transparently rotates the token. Requires " +
      "admin role.",
    schema: connectQaihubInputSchema,
    handler: connectQaihubHandler,
  },
  {
    name: "edgegate_get_qaihub_integration",
    description:
      "Show whether a Qualcomm AI Hub token is connected to this workspace and " +
      "whether it is currently active. Does not return the token itself.",
    schema: getQaihubIntegrationInputSchema,
    handler: getQaihubIntegrationHandler,
  },
  {
    name: "edgegate_disconnect_qaihub",
    description:
      "Permanently delete the workspace's Qualcomm AI Hub integration. Any new EdgeGate " +
      "runs in this workspace will then fail with NO_AIHUB_TOKEN until a fresh token is " +
      "connected. Requires owner role.",
    schema: disconnectQaihubInputSchema,
    handler: disconnectQaihubHandler,
  },
  {
    name: "edgegate_create_workspace",
    description:
      "Create a new EdgeGate workspace. The caller automatically becomes the owner. " +
      "Subject to plan-tier workspace limits. After creation, connect Qualcomm AI Hub " +
      "and define pipelines as usual.",
    schema: createWorkspaceInputSchema,
    handler: createWorkspaceHandler,
  },
  {
    name: "edgegate_list_api_keys",
    description:
      "List all API keys in this workspace (id, name, prefix...suffix, status, last_used). " +
      "Plaintext is never returned. Requires owner role.",
    schema: listApiKeysInputSchema,
    handler: listApiKeysHandler,
  },
  {
    name: "edgegate_create_api_key",
    description:
      "Create a new API key for this workspace. The plaintext token is returned EXACTLY " +
      "ONCE in the response — copy it to your CI secrets or local env immediately. " +
      "Requires Pro tier or above. Requires owner role.",
    schema: createApiKeyInputSchema,
    handler: createApiKeyHandler,
  },
  {
    name: "edgegate_revoke_api_key",
    description:
      "Revoke an API key by id. The key is immediately rejected for all subsequent " +
      "requests; the row is preserved (with revoked_at set) so the audit trail survives. " +
      "Destructive. Requires owner role.",
    schema: revokeApiKeyInputSchema,
    handler: revokeApiKeyHandler,
  },
  {
    name: "edgegate_list_members",
    description:
      "List all members of this workspace with their email + role. Requires at least " +
      "viewer role.",
    schema: listMembersInputSchema,
    handler: listMembersHandler,
  },
  {
    name: "edgegate_list_devices",
    description:
      "List every Qualcomm AI Hub device EdgeGate can target (Snapdragon phones, " +
      "QRD/CRD reference platforms, IoT Dragonwing, automotive, XR). Returns a " +
      "markdown table grouped by category. Use the `id` column verbatim when " +
      "building a `create_pipeline` device matrix. No workspace_id needed — the " +
      "catalog is global.",
    schema: listDevicesInputSchema,
    handler: listDevicesHandler,
  },
  {
    name: "edgegate_list_device_targets",
    description:
      "List the customer's OWN connected devices (Jetson, Snapdragon hosts, gateways) " +
      "with live/offline status computed from each device's heartbeat (30s beat, 90s " +
      "window). This is the workspace fleet connected via `edgegate-runner agent` — " +
      "NOT the global AI Hub catalog (use edgegate_list_devices for that). If empty, " +
      "the response includes copy-paste connect instructions for the customer.",
    schema: listDeviceTargetsInputSchema,
    handler: listDeviceTargetsHandler,
  },
  {
    name: "edgegate_run_device_benchmark",
    description:
      "Dispatch an ONNX benchmark to one of the customer's connected devices " +
      "(Jetson, Snapdragon host, gateway) by name/id. The on-device agent picks it " +
      "up within ~30s and reports latency/memory results. Multi-silicon: works for " +
      "any vendor the customer has connected. Requires admin role.",
    schema: runDeviceBenchmarkInputSchema,
    handler: runDeviceBenchmarkHandler,
  },
  {
    name: "edgegate_invite_member",
    description:
      "Add an existing EdgeGate user to this workspace by email at the given role " +
      "(owner / admin / viewer). v1 only attaches existing users — does not send " +
      "invitation emails to external addresses. Requires admin role; only owners can " +
      "add other owners.",
    schema: inviteMemberInputSchema,
    handler: inviteMemberHandler,
  },
  {
    name: "edgegate_change_member_role",
    description:
      "Change a member's role in this workspace. Cannot downgrade the last owner — " +
      "promote another member to owner first. Requires owner role.",
    schema: changeMemberRoleInputSchema,
    handler: changeMemberRoleHandler,
  },
  {
    name: "edgegate_remove_member",
    description:
      "Remove a member from this workspace. The user loses access immediately; their " +
      "pipelines and runs are preserved. Cannot remove the last owner. Destructive. " +
      "Requires owner role.",
    schema: removeMemberInputSchema,
    handler: removeMemberHandler,
  },
  {
    name: "edgegate_setup_byo_storage",
    description:
      "Enterprise only. Zero-friction BYO storage setup — creates a pending grant " +
      "with EdgeGate (returns the External ID) and returns the exact AWS CLI " +
      "commands the agent should run to create the IAM role in the customer's " +
      "AWS account. Pair with edgegate_attach_byo_role to finalize. Prefer this " +
      "over edgegate_register_byo_bucket for new setups — the agent doesn't have " +
      "to figure out the trust policy or guess at role names. Requires owner role. " +
      "402 from non-Enterprise workspaces; if a non-pending grant exists, instructs " +
      "the agent to disconnect first.",
    schema: setupByoStorageInputSchema,
    handler: setupByoStorageHandler,
  },
  {
    name: "edgegate_attach_byo_role",
    description:
      "Phase 2 of edgegate_setup_byo_storage. Hands the freshly-created Role ARN " +
      "back to EdgeGate, which runs sts:AssumeRole + a deny-by-default HEAD " +
      "probe to verify the trust + permission policies are correct. Flips the " +
      "grant to 'active' on success, or returns a typed BYO_* error with a " +
      "checklist of common misconfigurations on failure. Re-callable with the " +
      "same role_arn after fixing IAM.",
    schema: attachByoRoleInputSchema,
    handler: attachByoRoleHandler,
  },
  {
    name: "edgegate_register_byo_bucket",
    description:
      "Enterprise only. **Use edgegate_setup_byo_storage instead for new setups** — " +
      "this tool only works if you already have an IAM role and just want to register " +
      "its ARN. Registers the workspace's customer-owned S3 bucket + IAM role as a BYO " +
      "storage grant. EdgeGate's workers will AssumeRole into your AWS account to read " +
      "model bytes — they never leave your account. Returns the External ID you must " +
      "add to your role's trust policy. Requires owner role. 402 from non-Enterprise " +
      "workspaces; 409 if a grant already exists.",
    schema: registerByoBucketInputSchema,
    handler: registerByoBucketHandler,
  },
  {
    name: "edgegate_check_byo_bucket",
    description:
      "Re-run the AssumeRole + HeadObject readiness probe against the workspace's " +
      "BYO grant. Returns the updated grant status with the typed BYO_* error code " +
      "if it failed, plus a checklist of common IAM / bucket / KMS misconfigurations " +
      "to inspect. Requires admin role.",
    schema: checkByoBucketInputSchema,
    handler: checkByoBucketHandler,
  },
  {
    name: "edgegate_register_byo_artifact",
    description:
      "Register an existing S3 URI in your registered bucket as an EdgeGate Artifact. " +
      "EdgeGate HeadObjects the URI to confirm the key exists + capture size/etag — " +
      "bytes are NOT uploaded through EdgeGate. Returns an artifact_id you can pass " +
      "directly to edgegate_create_pipeline / edgegate_run_gate. Requires admin role. " +
      "Pre-conditions: Enterprise plan + active BYO grant + bucket matches the grant.",
    schema: registerByoArtifactInputSchema,
    handler: registerByoArtifactHandler,
  },
  {
    name: "edgegate_disconnect_byo_bucket",
    description:
      "Delete the workspace's BYO storage grant. EdgeGate stops attempting to read " +
      "from your bucket. Refuses (409) if artifacts still reference it — surface " +
      "lists the safe paths forward (rotate External ID via dashboard, or drop the " +
      "artifacts first). Destructive. Requires owner role.",
    schema: disconnectByoBucketInputSchema,
    handler: disconnectByoBucketHandler,
  },
  {
    name: "edgegate_llm_compile",
    description:
      "Submit a multi-component LLM compile + link job via Qualcomm AI Hub. Returns a " +
      "compile_job_id; poll with edgegate_check_llm_compile_status. Spend is gated by " +
      "the workspace's monthly LLM compile cap (default 100/mo Pro tier). Each compile " +
      "produces a composite QNN_DLC linked model + 3 component artifacts (prompt / token / " +
      "kv_cache). Compile target_runtime is QNN_DLC under the hood despite the genie " +
      "label — the label is for downstream profile dispatch hints only.",
    schema: llmCompileInputSchema,
    handler: llmCompileHandler,
  },
  {
    name: "edgegate_check_llm_compile_status",
    description:
      "Poll an LLM compile job. Returns status (queued|running|completed|failed), " +
      "composite_artifact_id when complete, error_detail when failed, and " +
      "progress.compile_jobs_done / total.",
    schema: checkLLMCompileStatusInputSchema,
    handler: checkLLMCompileStatusHandler,
  },
  {
    name: "edgegate_get_byo_audit",
    description:
      "Fetch the workspace's append-only BYO storage audit log (every AssumeRole, " +
      "HeadObject, GetObject, KMS Decrypt). Supports filters by artifact_id, run_id, " +
      "since timestamp, plus cursor pagination. Each row's aws_request_id is the " +
      "join key for cross-referencing against your own CloudTrail. Requires admin role.",
    schema: getByoAuditInputSchema,
    handler: getByoAuditHandler,
  },
  {
    name: "edgegate_list_eval_packs",
    description:
      "List the bundled behavioral eval-set starter packs a customer can clone from. " +
      "Returns each pack's id, name, case count, and balance (must_refuse / task counts). " +
      "Clone one into a new eval set via edgegate_create_eval_set(clone_from=<id>). No " +
      "workspace_id needed — the pack library is global.",
    schema: listEvalPacksInputSchema,
    handler: listEvalPacksHandler,
  },
  {
    name: "edgegate_create_eval_set",
    description:
      "Create a new behavioral eval set with its first draft version. Seed it from a " +
      "bundled pack (clone_from), with explicit cases, both, or neither (empty draft). " +
      "Each case has six fields: case_id, prompt, category (jailbreak|forbidden_action|" +
      "task|format), forbidden_actions, must_refuse, expected_task_answer. Drafts are NOT " +
      "validated here — only edgegate_publish_eval_set freezes + gates. Requires workspace " +
      "write access.",
    schema: createEvalSetInputSchema,
    handler: createEvalSetHandler,
  },
  {
    name: "edgegate_list_eval_sets",
    description:
      "List the workspace's behavioral eval sets — eval_set_id, name, latest version, and " +
      "creation date. Use the eval_set_id with the update / publish / new-version tools.",
    schema: listEvalSetsInputSchema,
    handler: listEvalSetsHandler,
  },
  {
    name: "edgegate_update_eval_set",
    description:
      "Replace ALL cases of a DRAFT eval-set version (full replacement list, not a patch). " +
      "Published versions are immutable — a 409 here means you must fork a fresh draft with " +
      "edgegate_new_eval_set_version first. Still leaves the version a draft; publish " +
      "separately. Requires workspace write access.",
    schema: updateEvalSetInputSchema,
    handler: updateEvalSetHandler,
  },
  {
    name: "edgegate_publish_eval_set",
    description:
      "Validate and freeze a draft eval-set version into an immutable, signed, hash-anchored " +
      "version. On success returns eval_set_sha256 + artifact_id (feed both into a 3b " +
      "Behavioral-Gate run). On validation failure returns the balance/structural violations " +
      "and the version stays a draft (floor: ≥5 must_refuse-with-forbidden cases + ≥1 task " +
      "case). Requires workspace write access.",
    schema: publishEvalSetInputSchema,
    handler: publishEvalSetHandler,
  },
  {
    name: "edgegate_new_eval_set_version",
    description:
      "Fork a fresh draft (version+1) from a PUBLISHED version, seeded with its cases — the " +
      "edit-after-publish path. Edit the new draft with edgegate_update_eval_set, then " +
      "re-publish. The original published version (and any references / runs bound to its " +
      "sha) is untouched. Requires workspace write access.",
    schema: newEvalSetVersionInputSchema,
    handler: newEvalSetVersionHandler,
  },
  {
    name: "edgegate_capture_reference",
    description:
      "Trigger a reference-oracle capture — the known-good baseline the Behavioral Gate diffs " +
      "the on-device quantized model against. Specify EXACTLY one flavor: hf_repo (auto-FP16, " +
      "EdgeGate runs the un-quantized same model) or reference_upload_artifact_id (golden, " +
      "customer-supplied). Returns a job_id to poll. Requires workspace admin access.",
    schema: captureReferenceInputSchema,
    handler: captureReferenceHandler,
  },
  {
    name: "edgegate_check_reference_capture_status",
    description:
      "Poll a reference-capture job. When status is done, returns reference_artifact_id — an " +
      "ArtifactKind.REFERENCE artifact — to feed into edgegate_create_bg_run as the gate's " +
      "trustworthy baseline. Requires workspace admin access.",
    schema: checkReferenceCaptureStatusInputSchema,
    handler: checkReferenceCaptureStatusHandler,
  },
  {
    name: "edgegate_compile_genie",
    description:
      "Submit a 3-lane genie compile for the Behavioral Gate's self-hosted runner. Specify " +
      "EXACTLY one lane selector: hf_repo (Lane A — EdgeGate compiles a HuggingFace repo), " +
      "onnx_artifact_ids (Lane B — genie-ready multi-part ONNX, compile-and-link), or " +
      "bundle_artifact_id (Lane C — an already-precompiled bundle). Returns a job_id to poll. " +
      "Requires workspace admin access.",
    schema: compileGenieInputSchema,
    handler: compileGenieHandler,
  },
  {
    name: "edgegate_check_genie_compile_status",
    description:
      "Poll a genie-compile job. When status is done, returns bundle_artifact_id — the " +
      "compiled genie bundle to feed into edgegate_create_bg_run. Requires workspace admin " +
      "access.",
    schema: checkGenieCompileStatusInputSchema,
    handler: checkGenieCompileStatusHandler,
  },
  {
    name: "edgegate_create_bg_run",
    description:
      "Wire a compiled genie bundle + published eval set + reference oracle into a " +
      "behavioral-gate Run — populates Run.runner_config_json so the self-hosted runner can " +
      "execute the gate on-device. Errors with a mismatch hint when the reference was captured " +
      "against a different eval-set version (eval_set_sha256 differs). Requires workspace admin " +
      "access.",
    schema: createBgRunInputSchema,
    handler: createBgRunHandler,
  },
  {
    name: "edgegate_cancel_run",
    description:
      "Cancel a non-terminal run, freeing the workspace's single active-run slot. Useful for a " +
      "behavioral-gate run left queued waiting for a device that never reports back (it would " +
      "otherwise block new runs). 409 if the run is already terminal.",
    schema: cancelRunInputSchema,
    handler: cancelRunHandler,
  },
  {
    name: "edgegate_rerun_bg",
    description:
      "Re-run an existing behavioral-gate run: clones its already-validated config (same bundle + " +
      "eval set + reference + system prompt + device) into a fresh queued run — no need to " +
      "re-supply artifact ids. 409 if the workspace already has an active run (cancel it first).",
    schema: rerunBgInputSchema,
    handler: rerunBgHandler,
  },
  {
    name: "edgegate_setup_bg_github_action",
    description:
      "Generate the Behavioral-Gate GitHub Actions setup — the self-hosted-runner prerequisites, " +
      "the workflow YAML (using the edgegate-bg composite action), and the gh secret commands. " +
      "Unlike the standard run gate, BG runs the model on a real device, so it needs a " +
      "self-hosted runner with the device attached.",
    schema: setupBgGithubActionInputSchema,
    handler: setupBgGithubActionHandler,
  },
  {
    name: "edgegate_export_compliance_report",
    description:
      "Export the compliance-preset report for a run (e.g. ISO 26262 verification " +
      "evidence) — a re-frame of the run's already-signed evidence against the " +
      "standard's clauses (config identification, verification, change mgmt, tool " +
      "classification, integrity). Verification evidence, NOT a compliance " +
      "certification. The formatted assessor PDF is on the dashboard run page.",
    schema: exportComplianceReportInputSchema,
    handler: exportComplianceReportHandler,
  },
] as const;

function getClient(): EdgeGateClient {
  const apiUrl = process.env.EDGEGATE_API_URL ?? "https://edgegateapi.frozo.ai";
  const apiKey = process.env.EDGEGATE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EDGEGATE_API_KEY is not set. Set it in your MCP client config. Generate a " +
        "key at https://edgegate.frozo.ai/workspace/<id>/settings#api-keys."
    );
  }
  return new EdgeGateClient({ apiUrl, apiKey });
}

async function main(): Promise<void> {
  const server = new Server(
    { name: "edgegate-mcp", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema) as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    const parsed = tool.schema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Invalid arguments for ${tool.name}: ${parsed.error.message}` },
        ],
      };
    }
    const client = getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tool.handler(client, parsed.data as any) as any;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error(`edgegate-mcp ${VERSION} listening on stdio`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err);
  process.exit(1);
});
