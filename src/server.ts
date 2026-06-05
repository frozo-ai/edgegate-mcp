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
