/**
 * Saved workflow endpoints — the target of an API/workflow behavioral gate.
 *
 * These exist because `endpoint_id` was otherwise unreachable from MCP. An
 * agent could only inline an `http` descriptor, and an inline descriptor cannot
 * carry a credential (the backend 422s secret-like keys, because
 * `runner_config_json` is readable by any workspace viewer). A saved endpoint
 * is the only place a credential can live — envelope-encrypted server-side,
 * write-only, never returned by any read path.
 *
 * The probe matters more than it looks: it is the only thing that catches a
 * wrong `response_text_path` BEFORE a baseline is certified. A wrong path
 * yields empty text, empty text scores as a refusal, and a baseline of
 * universal refusals makes every later gate pass trivially.
 */
import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import type { WorkflowEndpointCreateBody } from "../types.js";

const TRANSPORTS = ["openai_chat", "webhook"] as const;

export const listWorkflowEndpointsInputSchema = z
  .object({ workspace_id: z.string().uuid() })
  .strict();

export const createWorkflowEndpointInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    name: z.string().min(1).max(120).describe("Human-readable label, e.g. 'support workflow'."),
    endpoint_url: z
      .string()
      .url()
      .describe(
        "https URL EdgeGate will call. Internal targets (loopback, RFC1918, link-local, " +
          "the cloud metadata IP) are refused with 422."
      ),
    transport: z
      .enum(TRANSPORTS)
      .optional()
      .describe(
        "'webhook' for n8n/Zapier/Make (posts request_template, reads response_text_path); " +
          "'openai_chat' for an OpenAI-compatible /chat/completions API. Defaults to openai_chat."
      ),
    model: z.string().optional().describe("Model name, for openai_chat transports."),
    request_template: z
      .record(z.unknown())
      .optional()
      .describe(
        "Webhook body shape with {{prompt}} and {{case_id}} placeholders, e.g. " +
          '{"chatInput": "{{prompt}}", "case_id": "{{case_id}}"}. Match your workflow\'s own ' +
          "input field — n8n often nests it under body."
      ),
    response_text_path: z
      .string()
      .optional()
      .describe(
        "Dotted path to the reply text in the response, e.g. 'reply' or 'json.output'. " +
          "Verify it with edgegate_probe_workflow_endpoint before capturing a baseline."
      ),
    response_tools_path: z
      .string()
      .optional()
      .describe("Dotted path to tool calls in the response, if the workflow emits them."),
    secret: z
      .string()
      .optional()
      .describe(
        "Bearer credential for the endpoint. Stored envelope-encrypted and never returned " +
          "by any read path — only has_secret and secret_last4 are visible afterwards. This " +
          "is the only supported way to gate an authenticated endpoint."
      ),
  })
  .strict();

export const probeWorkflowEndpointInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    endpoint_id: z.string().uuid(),
    prompt: z.string().optional().describe("Test prompt. Defaults to a short connection check."),
  })
  .strict();

export type ListWorkflowEndpointsInput = z.infer<typeof listWorkflowEndpointsInputSchema>;
export type CreateWorkflowEndpointInput = z.infer<typeof createWorkflowEndpointInputSchema>;
export type ProbeWorkflowEndpointInput = z.infer<typeof probeWorkflowEndpointInputSchema>;

function surface(err: EdgeGateError): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          err.status === 401
            ? "EDGEGATE_API_KEY is missing, expired, or revoked."
            : err.status === 403
              ? "You need admin access on this workspace to manage workflow endpoints."
              : err.status === 422
                ? `EdgeGate refused the endpoint: ${err.detail}. Internal or credential-bearing ` +
                  "URLs are blocked; pass the credential in `secret`, not in the URL."
                : `EdgeGate returned ${err.status}: ${err.detail}`,
      },
    ],
  };
}

export async function listWorkflowEndpointsHandler(
  client: EdgeGateClient,
  input: ListWorkflowEndpointsInput
): Promise<ToolResult> {
  try {
    const rows = await client.listWorkflowEndpoints(input.workspace_id);
    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              "No saved workflow endpoints. Create one with " +
              "`edgegate_create_workflow_endpoint`.",
          },
        ],
      };
    }
    const text = [
      `${rows.length} saved workflow endpoint(s):`,
      ``,
      ...rows.map(
        (e) =>
          `- ${e.name} — ${e.id}\n  ${e.transport} · ${e.endpoint_url}` +
          (e.has_secret ? ` · key ••••${e.secret_last4 ?? ""}` : " · no credential") +
          (e.response_text_path ? `\n  response_text_path: ${e.response_text_path}` : "")
      ),
      ``,
      "Pass an id as `endpoint_id` to `edgegate_capture_reference` and `edgegate_create_bg_run`.",
    ].join("\n");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) return surface(err);
    throw err;
  }
}

export async function createWorkflowEndpointHandler(
  client: EdgeGateClient,
  input: CreateWorkflowEndpointInput
): Promise<ToolResult> {
  try {
    const body: WorkflowEndpointCreateBody = {
      name: input.name,
      endpoint_url: input.endpoint_url,
    };
    if (input.transport !== undefined) body.transport = input.transport;
    if (input.model !== undefined) body.model = input.model;
    if (input.request_template !== undefined) body.request_template = input.request_template;
    if (input.response_text_path !== undefined) body.response_text_path = input.response_text_path;
    if (input.response_tools_path !== undefined)
      body.response_tools_path = input.response_tools_path;
    if (input.secret !== undefined) body.secret = input.secret;

    const e = await client.createWorkflowEndpoint(input.workspace_id, body);
    const text = [
      `Saved workflow endpoint:`,
      ``,
      `- endpoint_id: ${e.id}`,
      `- ${e.transport} · ${e.endpoint_url}`,
      `- credential: ${e.has_secret ? `stored (••••${e.secret_last4 ?? ""})` : "none"}`,
      ``,
      "Send one test request with `edgegate_probe_workflow_endpoint` BEFORE capturing a " +
        "baseline — a wrong response_text_path yields empty text, which scores as a refusal " +
        "and would make every later gate pass trivially.",
    ].join("\n");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) return surface(err);
    throw err;
  }
}

export async function probeWorkflowEndpointHandler(
  client: EdgeGateClient,
  input: ProbeWorkflowEndpointInput
): Promise<ToolResult> {
  try {
    const body = input.prompt !== undefined ? { prompt: input.prompt } : {};
    const p = await client.probeWorkflowEndpoint(input.workspace_id, input.endpoint_id, body);

    if (!p.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: [
              `The endpoint did not answer usably.`,
              p.error ? `- error: ${p.error}` : "",
              p.hint ? `- hint: ${p.hint}` : "",
              p.raw_response ? `- raw response: ${p.raw_response}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    }

    const text = [
      `Endpoint replied.`,
      ``,
      `Extracted text: ${JSON.stringify(p.extracted_text)}`,
      p.tool_calls.length ? `Tool calls: ${p.tool_calls.join(", ")}` : "",
      ``,
      `Raw response (credential redacted):`,
      p.raw_response ?? "(none)",
      ``,
      p.extracted_text
        ? "If the extracted text is the reply you expected, the endpoint is ready to capture."
        : "Extraction returned EMPTY — response_text_path is probably wrong. Fix it before " +
          "capturing, or the baseline will be all-refusals and every later gate passes trivially.",
    ]
      .filter(Boolean)
      .join("\n");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) return surface(err);
    throw err;
  }
}
