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
      "and which gates (e.g. inference_time_ms ≤ 10) the pipeline will enforce.",
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
