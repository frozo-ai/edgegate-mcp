import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import type { BgRunCreateBody } from "../types.js";

/**
 * Wire a compiled bundle + published eval set + reference oracle into a Run
 * (populates `Run.runner_config_json`, making the self-hosted runner drivable).
 * The backend rejects with 400 when the reference's `eval_set_sha256` does not
 * match the eval set's — the gate would be diffing against the wrong baseline.
 */
export const createBgRunInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    bundle_artifact_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Compiled genie bundle artifact id from edgegate_check_genie_compile_status. " +
          "Omit for an API/workflow gate (vendor='http') — an endpoint has no compiled bundle."
      ),
    eval_set_artifact_id: z
      .string()
      .uuid()
      .describe("Published eval-set artifact id from edgegate_publish_eval_set."),
    reference_artifact_id: z
      .string()
      .uuid()
      .describe("Reference-oracle artifact id from edgegate_check_reference_capture_status."),
    vendor: z.string().optional().describe('Runner vendor. Defaults to "qualcomm".'),
    system_prompt: z
      .string()
      .optional()
      .describe("System prompt the run executes under. Defaults to empty."),
    decode_config: z
      .record(z.unknown())
      .optional()
      .describe('Decode settings, e.g. {"seed": 0}. Defaults to an empty object.'),
    device_label: z
      .string()
      .optional()
      .describe(
        "Human-readable device label, e.g. " +
          '"Samsung Galaxy S23 Ultra / Snapdragon 8 Gen 2 (SM8550)".'
      ),
    geniex_model: z
      .string()
      .optional()
      .describe(
        "GenieX on-device LLM: the model name as it appears in the device's GenieX " +
          "model cache, e.g. 'Llama-3.2-3B-Instruct'. Use with vendor='qualcomm-geniex'."
      ),
    endpoint_id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "API/workflow gate: a saved endpoint id from edgegate_list_workflow_endpoints. " +
          "Mutually exclusive with `http`. Prefer this over an inline descriptor — the " +
          "baseline and the gate then provably target the same endpoint."
      ),
    http: z
      .record(z.unknown())
      .optional()
      .describe(
        "API/workflow gate: inline endpoint descriptor {endpoint_url, transport, " +
          "request_template, response_text_path, ...}. Mutually exclusive with " +
          "`endpoint_id`. Must NOT contain credentials — the backend 422s on secret-like " +
          "keys because runner_config_json is readable by any workspace viewer."
      ),
    execution: z
      .enum(["hosted", "runner"])
      .optional()
      .describe(
        "Who makes the calls for vendor='http'. 'hosted' (default) — EdgeGate's workers, " +
          "nothing to install. 'runner' — your own box via edgegate-runner, for endpoints " +
          "EdgeGate cannot reach or when raw model output must not leave your network."
      ),
    requirement_map: z
      .record(z.record(z.string()))
      .optional()
      .describe(
        "ISO 26262 traceability: maps a gate/signal name to its safety requirement " +
          'id + ASIL, e.g. {"forbidden_action": {"requirement_id": "SR-CABIN-014", ' +
          '"asil": "B"}}. Surfaced by edgegate_export_compliance_report.'
      ),
  })
  .strict()
  // Mirrors the backend's 422 so the agent is told what to fix instead of
  // burning a round trip. Two targets in one request is the exact ambiguity the
  // saved endpoint exists to remove, so it is refused rather than ranked.
  .refine((v) => !(v.endpoint_id && v.http), {
    message: "pass either endpoint_id or http, not both",
  })
  // An API gate has no bundle; a device gate has nothing to call. Catching the
  // swap here beats a 404 on an artifact id that was never the problem.
  .refine((v) => !(v.bundle_artifact_id && (v.endpoint_id || v.http)), {
    message:
      "bundle_artifact_id is for a device gate; endpoint_id/http is for an API gate — not both",
  })
  .refine((v) => v.bundle_artifact_id || v.endpoint_id || v.http || v.geniex_model, {
    message:
      "specify what to gate: bundle_artifact_id (compiled bundle), geniex_model (on-device " +
      "LLM), or endpoint_id/http (API or workflow endpoint)",
  });

export type CreateBgRunInput = z.infer<typeof createBgRunInputSchema>;

export async function createBgRunHandler(
  client: EdgeGateClient,
  input: CreateBgRunInput
): Promise<ToolResult> {
  try {
    const body: BgRunCreateBody = {
      eval_set_artifact_id: input.eval_set_artifact_id,
      reference_artifact_id: input.reference_artifact_id,
    };
    if (input.bundle_artifact_id !== undefined) body.bundle_artifact_id = input.bundle_artifact_id;
    if (input.vendor !== undefined) body.vendor = input.vendor;
    if (input.system_prompt !== undefined) body.system_prompt = input.system_prompt;
    if (input.decode_config !== undefined) body.decode_config = input.decode_config;
    if (input.device_label !== undefined) body.device_label = input.device_label;
    if (input.requirement_map !== undefined) body.requirement_map = input.requirement_map;
    if (input.geniex_model !== undefined) body.geniex_model = input.geniex_model;
    if (input.endpoint_id !== undefined) body.endpoint_id = input.endpoint_id;
    if (input.http !== undefined) body.http = input.http;
    if (input.execution !== undefined) body.execution = input.execution;

    const run = await client.createBgRun(input.workspace_id, body);

    // Mirrors the backend's rule: an endpoint target runs hosted unless the
    // caller explicitly opted into the runner.
    const isHosted = Boolean(input.endpoint_id || input.http) && input.execution !== "runner";

    const text = [
      `Created a behavioral-gate run:`,
      ``,
      `- run_id: ${run.run_id}`,
      `- status: ${run.status}`,
      ``,
      // A hosted run is executed by EdgeGate's workers, and the backend now
      // 409s a runner that tries to pull it — so telling the agent to point a
      // runner at it would send it at an operation that is refused by design.
      isHosted
        ? `EdgeGate is executing this run against your endpoint — nothing to install. ` +
          `Poll it with \`edgegate_check_status\`. The verdict is tagged API-verified, ` +
          `not hardware-certified.`
        : `The run's \`runner_config_json\` is now populated — point the self-hosted runner ` +
          `at this run to execute the gate.`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 400) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Reference / eval-set mismatch: the reference oracle was captured against a " +
                "different eval-set version (eval_set_sha256 differs). Re-capture the reference " +
                "against this exact published eval set, then retry.",
            },
          ],
        };
      }
      return surfaceCreateBgRunError(err);
    }
    throw err;
  }
}

/** Shared EdgeGateError → ToolResult formatter for the create-bg-run tool. */
export function surfaceCreateBgRunError(err: EdgeGateError): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          err.status === 401
            ? "EDGEGATE_API_KEY is missing, expired, or revoked. Generate a fresh key at " +
              "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys and retry."
            : err.status === 403
              ? "You need admin access on this workspace to create behavioral-gate runs."
              : err.status === 404
                ? "Unknown workspace, bundle, eval-set, or reference artifact. Re-check the ids."
                : `EdgeGate returned ${err.status}: ${err.detail}`,
      },
    ],
  };
}
