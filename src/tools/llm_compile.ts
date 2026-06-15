import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const llmCompileInputSchema = z.object({
  workspace_id: z.string().uuid(),
  /**
   * Pre-uploaded source artifacts (1 per component). Typical Llama-class:
   * 3 artifacts (prompt + token + kv_cache). For other architectures pass
   * M artifacts matching the number of components.
   */
  source_artifact_ids: z.array(z.string().uuid()).min(1).max(8),
  /** AI Hub device id (e.g. "x_elite", "x2_elite", "sa8295p"). */
  device_id: z.string().min(1),
  /**
   * Label only — backend always compiles to QNN_DLC under the hood. The
   * label is used downstream for profile dispatch hints.
   */
  target_runtime: z.string().min(1).default("genie"),
  /** Default [128, 1] — typical prompt/token split for Llama-class. */
  sequence_lengths: z.array(z.number().int().positive()).default([128, 1]),
  /** Default [4096]. */
  context_lengths: z.array(z.number().int().positive()).default([4096]),
  /**
   * Per-component role labels (e.g. ["prompt", "token", "kv_cache"]).
   * Required when source_artifact_ids has >1 entry — the AI Hub SDK
   * mandates graph_names for multi-component compiles.
   */
  roles: z.array(z.string().min(1)).optional(),
});

export type LLMCompileInput = z.infer<typeof llmCompileInputSchema>;

export async function llmCompileHandler(
  client: EdgeGateClient,
  input: LLMCompileInput
): Promise<ToolResult> {
  // Client-side guard: roles required when multi-component. Surface the
  // same constraint the backend enforces so the agent gets a clean error
  // without a network round-trip.
  if (input.source_artifact_ids.length > 1 && (!input.roles || input.roles.length === 0)) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `'roles' is required when source_artifact_ids has more than 1 entry ` +
            `(the AI Hub SDK requires graph_names for multi-component compiles). ` +
            `Typical Llama-class: roles=["prompt", "token", "kv_cache"].`,
        },
      ],
    };
  }
  if (input.roles && input.roles.length !== input.source_artifact_ids.length) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `'roles' length (${input.roles.length}) must match source_artifact_ids ` +
            `length (${input.source_artifact_ids.length}).`,
        },
      ],
    };
  }

  try {
    const job = await client.submitLLMCompile(input.workspace_id, {
      source_artifact_ids: input.source_artifact_ids,
      device_id: input.device_id,
      target_runtime: input.target_runtime,
      sequence_lengths: input.sequence_lengths,
      context_lengths: input.context_lengths,
      ...(input.roles !== undefined ? { roles: input.roles } : {}),
    });

    return {
      content: [
        {
          type: "text",
          text: [
            `LLM compile job submitted.`,
            ``,
            `- compile_job_id: ${job.compile_job_id}`,
            `- status: ${job.status}`,
            `- components: ${input.source_artifact_ids.length}`,
            `- device: ${input.device_id}`,
            `- target_runtime: ${input.target_runtime} (compiled to QNN_DLC under the hood)`,
            ``,
            `Poll status with:`,
            `  edgegate_check_llm_compile_status({ workspace_id: "${input.workspace_id}", compile_job_id: "${job.compile_job_id}" })`,
            ``,
            `When status=completed, composite_artifact_id is the QNN_DLC linked model ready to use in a pipeline.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 402
                ? `Your workspace has hit its monthly LLM compile cap (default 100/mo on Pro). ` +
                  `Upgrade at https://edgegate.frozo.ai/pricing or wait until next billing cycle.\n\n` +
                  `Detail: ${err.detail}`
                : err.status === 401
                  ? "EDGEGATE_API_KEY is missing, expired, or revoked. Generate a fresh key at " +
                    "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys and retry."
                  : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
