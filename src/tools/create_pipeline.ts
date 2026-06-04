import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

const MAX_CELLS = 25;

export const createPipelineInputSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  models: z
    .array(z.object({ name: z.string().min(1), artifact_id: z.string().min(1) }))
    .min(1)
    .max(10),
  devices: z.array(z.string().min(1)).min(1).max(5),
  gates: z
    .array(
      z.object({
        metric: z.enum(["inference_time_ms", "peak_memory_mb", "throughput_tps"]),
        operator: z.enum(["<=", "<", ">=", ">", "=="]),
        threshold: z.number().positive(),
      })
    )
    .min(1),
  promptpack_id: z.string().uuid().optional(),
  repeats: z.number().int().min(1).max(5).optional(),
});

export type CreatePipelineInput = z.infer<typeof createPipelineInputSchema>;

export async function createPipelineHandler(
  client: EdgeGateClient,
  input: CreatePipelineInput
): Promise<ToolResult> {
  const cellCount = input.models.length * input.devices.length;
  if (cellCount > MAX_CELLS) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `${input.models.length} models × ${input.devices.length} devices = ${cellCount} cells, ` +
            `which exceeds the per-run limit of ${MAX_CELLS}. Reduce the matrix or split ` +
            `into multiple pipelines.`,
        },
      ],
    };
  }
  try {
    const pipeline = await client.createPipeline(input.workspace_id, {
      name: input.name,
      description: input.description,
      models: input.models,
      devices: input.devices,
      gates: input.gates,
      promptpack_id: input.promptpack_id,
      repeats: input.repeats,
    });
    return {
      content: [
        {
          type: "text",
          text: [
            `Created pipeline **${pipeline.name}** (id=${pipeline.id}).`,
            ``,
            `- ${input.models.length} model(s) × ${input.devices.length} device(s) = ${cellCount} cell(s) per run`,
            `- ${input.gates.length} gate(s)`,
            ``,
            `Trigger a run with \`edgegate_run_gate\`, or wire CI with \`edgegate_setup_github_action\`.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to create pipeline: ${err.detail}` }],
      };
    }
    throw err;
  }
}
