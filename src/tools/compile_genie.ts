import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import type { GenieCompileBody } from "../types.js";

/**
 * Submit a 3-lane genie compile. Exactly one lane selector decides the lane —
 * `hf_repo` (Lane A) XOR `onnx_artifact_ids` (Lane B, genie-ready multi-part)
 * XOR `bundle_artifact_id` (Lane C, precompiled bundle). The zod `.refine`
 * mirrors the backend's 422 rule so the agent gets the actionable error before
 * the network call; the handler also surfaces a server-side 422 (e.g. an
 * arbitrary single-ONNX Lane B that isn't genie-ready).
 */
export const compileGenieInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    device_id: z
      .string()
      .min(1, "device_id must be non-empty")
      .describe("Target device chipset id the bundle compiles for, e.g. sm8550."),
    hf_repo: z
      .string()
      .optional()
      .describe("Lane A: a HuggingFace repo id EdgeGate compiles into a genie bundle."),
    onnx_artifact_ids: z
      .array(z.string().uuid())
      .optional()
      .describe("Lane B: genie-ready multi-part ONNX artifact ids to compile-and-link."),
    bundle_artifact_id: z
      .string()
      .uuid()
      .optional()
      .describe("Lane C: an already-precompiled genie bundle artifact id."),
  })
  .strict()
  .refine(
    (v) =>
      [v.hf_repo, v.onnx_artifact_ids, v.bundle_artifact_id].filter(
        (s) => s !== undefined
      ).length === 1,
    {
      message:
        "specify exactly one lane selector: hf_repo (A), onnx_artifact_ids (B), or " +
        "bundle_artifact_id (C)",
    }
  );

export type CompileGenieInput = z.infer<typeof compileGenieInputSchema>;

export async function compileGenieHandler(
  client: EdgeGateClient,
  input: CompileGenieInput
): Promise<ToolResult> {
  try {
    const body: GenieCompileBody = { device_id: input.device_id };
    if (input.hf_repo !== undefined) body.hf_repo = input.hf_repo;
    if (input.onnx_artifact_ids !== undefined) body.onnx_artifact_ids = input.onnx_artifact_ids;
    if (input.bundle_artifact_id !== undefined)
      body.bundle_artifact_id = input.bundle_artifact_id;

    const job = await client.submitGenieCompile(input.workspace_id, body);

    const text = [
      `Queued a genie-compile job:`,
      ``,
      `- job_id: ${job.job_id}`,
      `- lane: ${job.lane}`,
      `- status: ${job.status}`,
      ``,
      `Poll it with \`edgegate_check_genie_compile_status\`. When done, feed the ` +
        `returned \`bundle_artifact_id\` into \`edgegate_create_bg_run\`.`,
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
                "Specify exactly one lane selector: hf_repo (A), onnx_artifact_ids (B, " +
                "genie-ready multi-part), or bundle_artifact_id (C) — not zero, not many, " +
                "and not an arbitrary single-ONNX Lane B.",
            },
          ],
        };
      }
      return surfaceCompileGenieError(err);
    }
    throw err;
  }
}

/** Shared EdgeGateError → ToolResult formatter for the compile-genie tools. */
export function surfaceCompileGenieError(err: EdgeGateError): ToolResult {
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
              ? "You need admin access on this workspace to compile genie bundles."
              : err.status === 404
                ? "Unknown workspace, artifact, or job. Re-check the ids."
                : `EdgeGate returned ${err.status}: ${err.detail}`,
      },
    ],
  };
}
