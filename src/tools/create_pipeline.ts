import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

const MAX_CELLS = 25;

// Operator mapping: user-friendly symbols → API enum values
const OPERATOR_MAP: Record<string, string> = {
  "<=": "lte",
  "<": "lt",
  ">=": "gte",
  ">": "gt",
  "==": "eq",
};

export const createPipelineInputSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  /** Required. Use the string promptpack_id (e.g. "image-classification-bench-v1"), not the UUID row id. */
  promptpack_id: z.string().min(1),
  /** PromptPack version string, e.g. "1.0.0" */
  promptpack_version: z.string().min(1).default("1.0.0"),
  /** Device names to include. E.g. ["Samsung Galaxy S24 (Family)"] */
  devices: z.array(z.string().min(1)).min(1).max(5),
  gates: z
    .array(
      z.object({
        metric: z.enum(["inference_time_ms", "peak_memory_mb", "throughput_tps"]),
        operator: z.enum(["<=", "<", ">=", ">", "=="]),
        threshold: z.number().positive(),
        description: z.string().optional(),
      })
    )
    .min(1),
  /**
   * Optional multi-model matrix. When omitted the pipeline runs in legacy
   * single-model mode (model_artifact_id is supplied per-run instead).
   */
  models: z
    .array(z.object({ name: z.string().min(1), artifact_id: z.string().min(1) }))
    .min(1)
    .max(10)
    .optional(),
  /** Measurement repeats per cell (1–5). Defaults to API default (3). */
  repeats: z.number().int().min(1).max(5).optional(),
});

export type CreatePipelineInput = z.infer<typeof createPipelineInputSchema>;

export async function createPipelineHandler(
  client: EdgeGateClient,
  input: CreatePipelineInput
): Promise<ToolResult> {
  // Guard: cell count limit applies when model_matrix is provided
  const modelCount = input.models?.length ?? 1;
  const cellCount = modelCount * input.devices.length;
  if (input.models && cellCount > MAX_CELLS) {
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

  // Translate user-facing shape → API shape
  const device_matrix = input.devices.map((name) => ({ name, enabled: true }));
  const promptpack_ref = {
    promptpack_id: input.promptpack_id,
    version: input.promptpack_version,
  };
  const gates = input.gates.map((g) => ({
    metric: g.metric,
    operator: OPERATOR_MAP[g.operator] ?? g.operator,
    threshold: g.threshold,
    ...(g.description !== undefined ? { description: g.description } : {}),
  }));
  const model_matrix = input.models?.map((m) => ({ artifact_id: m.artifact_id, label: m.name }));
  const run_policy = input.repeats !== undefined ? { measurement_repeats: input.repeats } : undefined;

  try {
    const pipeline = await client.createPipeline(input.workspace_id, {
      name: input.name,
      device_matrix,
      promptpack_ref,
      gates,
      ...(model_matrix !== undefined ? { model_matrix } : {}),
      ...(run_policy !== undefined ? { run_policy } : {}),
    });
    return {
      content: [
        {
          type: "text",
          text: [
            `Created pipeline **${pipeline.name}** (id=${pipeline.id}).`,
            ``,
            `- ${pipeline.device_count} device(s) × ${Math.max(pipeline.model_count, 1)} model(s) = ${pipeline.cell_count} cell(s) per run`,
            `- ${pipeline.gate_count} gate(s)`,
            `- PromptPack: ${pipeline.promptpack_id}@${pipeline.promptpack_version}`,
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
