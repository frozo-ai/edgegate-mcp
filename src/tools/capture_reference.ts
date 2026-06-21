import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import type { ReferenceCaptureBody } from "../types.js";

/**
 * Trigger a reference-oracle capture. Exactly one flavor selector — `hf_repo`
 * (auto-FP16) XOR `reference_upload_artifact_id` (golden) — must be set. The
 * zod `.refine` mirrors the backend's 422 rule so the agent gets the actionable
 * error before the network call; the handler also surfaces a server-side 422.
 */
export const captureReferenceInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    eval_set_artifact_id: z
      .string()
      .uuid()
      .describe("Published eval-set artifact id (the artifact_id from edgegate_publish_eval_set)."),
    system_prompt: z
      .string()
      .min(1, "system_prompt must be non-empty")
      .describe("System prompt the reference oracle is captured under."),
    decode_config: z
      .record(z.unknown())
      .optional()
      .describe('Decode settings, e.g. {"seed": 0}. Defaults to an empty object.'),
    hf_repo: z
      .string()
      .optional()
      .describe("auto-FP16 flavor: HF repo EdgeGate runs un-quantized as the oracle."),
    reference_upload_artifact_id: z
      .string()
      .uuid()
      .optional()
      .describe("golden flavor: a customer-supplied reference upload artifact id."),
  })
  .strict()
  .refine(
    (v) => [v.hf_repo, v.reference_upload_artifact_id].filter(Boolean).length === 1,
    {
      message:
        "specify exactly one of: hf_repo (auto-FP16) or reference_upload_artifact_id (golden)",
    }
  );

export type CaptureReferenceInput = z.infer<typeof captureReferenceInputSchema>;

export async function captureReferenceHandler(
  client: EdgeGateClient,
  input: CaptureReferenceInput
): Promise<ToolResult> {
  try {
    const body: ReferenceCaptureBody = {
      eval_set_artifact_id: input.eval_set_artifact_id,
      system_prompt: input.system_prompt,
    };
    if (input.decode_config !== undefined) body.decode_config = input.decode_config;
    if (input.hf_repo !== undefined) body.hf_repo = input.hf_repo;
    if (input.reference_upload_artifact_id !== undefined)
      body.reference_upload_artifact_id = input.reference_upload_artifact_id;

    const job = await client.captureReference(input.workspace_id, body);

    const text = [
      `Queued a reference-oracle capture:`,
      ``,
      `- job_id: ${job.job_id}`,
      `- flavor: ${job.flavor}`,
      `- status: ${job.status}`,
      ``,
      `Poll it with \`edgegate_check_reference_capture_status\`. When done, feed the ` +
        `returned \`reference_artifact_id\` into \`edgegate_create_bg_run\` as the gate's ` +
        `trustworthy baseline.`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 422) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Specify exactly one flavor: hf_repo (auto-FP16) or " +
                "reference_upload_artifact_id (golden) — not zero, not both.",
            },
          ],
        };
      }
      return surfaceReferenceError(err);
    }
    throw err;
  }
}

/** Shared EdgeGateError → ToolResult formatter for the reference-capture tools. */
export function surfaceReferenceError(err: EdgeGateError): ToolResult {
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
              ? "You need admin access on this workspace to capture reference oracles."
              : err.status === 404
                ? "Unknown workspace, eval-set artifact, or job. Re-check the ids."
                : `EdgeGate returned ${err.status}: ${err.detail}`,
      },
    ],
  };
}
