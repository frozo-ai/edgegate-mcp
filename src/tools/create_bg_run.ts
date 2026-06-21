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
      .describe("Compiled genie bundle artifact id from edgegate_check_genie_compile_status."),
    eval_set_artifact_id: z
      .string()
      .uuid()
      .describe("Published eval-set artifact id from edgegate_publish_eval_set."),
    reference_artifact_id: z
      .string()
      .uuid()
      .describe("Reference-oracle artifact id from edgegate_check_reference_capture_status."),
    vendor: z
      .string()
      .optional()
      .describe('Runner vendor. Defaults to "qualcomm".'),
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
  })
  .strict();

export type CreateBgRunInput = z.infer<typeof createBgRunInputSchema>;

export async function createBgRunHandler(
  client: EdgeGateClient,
  input: CreateBgRunInput
): Promise<ToolResult> {
  try {
    const body: BgRunCreateBody = {
      bundle_artifact_id: input.bundle_artifact_id,
      eval_set_artifact_id: input.eval_set_artifact_id,
      reference_artifact_id: input.reference_artifact_id,
    };
    if (input.vendor !== undefined) body.vendor = input.vendor;
    if (input.system_prompt !== undefined) body.system_prompt = input.system_prompt;
    if (input.decode_config !== undefined) body.decode_config = input.decode_config;
    if (input.device_label !== undefined) body.device_label = input.device_label;

    const run = await client.createBgRun(input.workspace_id, body);

    const text = [
      `Created a behavioral-gate run:`,
      ``,
      `- run_id: ${run.run_id}`,
      `- status: ${run.status}`,
      ``,
      `The run's \`runner_config_json\` is now populated — point the self-hosted runner ` +
        `at this run to execute the gate on-device.`,
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
