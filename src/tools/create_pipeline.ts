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
        metric: z.enum([
          // Stable — populated for every model AI Hub profiles successfully.
          "inference_time_ms",
          "peak_memory_mb",
          // Compute-unit breakdown — fires when AI Hub returns the per-IP
          // split. npu_compute_percent is the killer gate for "did silent
          // fallback to GPU/CPU happen?" — that's the EdgeGate value prop.
          "npu_compute_percent",
          "gpu_compute_percent",
          "cpu_compute_percent",
          // LLM-only — resolve to "Metric not available" on vision/audio
          // models. Backend names them `ttft_ms` and `tps` (NOT the legacy
          // `throughput_tps` we used to ship here).
          "ttft_ms",
          "tps",
          // Phase 1 (2026-06-11) — schema-verified AI Hub fields previously
          // dropped. Compile-time + cold/warm load metrics. See
          // docs/superpowers/plans/2026-06-11-gate-expansion.md.
          "compile_time_ms",
          "compile_peak_memory_mb",
          "first_load_time_ms",
          "first_load_peak_memory_mb",
          "warm_load_time_ms",
          // Phase 2a — layer-count composition. Gate on
          // `cpu_layer_count == 0` to catch silent NPU-fallback that
          // aggregate `npu_compute_percent` can miss.
          "npu_layer_count",
          "gpu_layer_count",
          "cpu_layer_count",
          "total_layer_count",
          "npu_layer_percent",
          "gpu_layer_percent",
          "cpu_layer_percent",
          // Phase 2b — CV (coefficient of variation) variants. Computed by
          // backend aggregator as `{source_metric}_cv`, preserving the unit
          // suffix. Gate on `inference_time_ms_cv < 0.05` for stricter
          // determinism than our default 10% flake threshold.
          "inference_time_ms_cv",
          "peak_memory_mb_cv",
          "npu_compute_percent_cv",
          "gpu_compute_percent_cv",
          "cpu_compute_percent_cv",
          "compile_time_ms_cv",
          "compile_peak_memory_mb_cv",
          "first_load_time_ms_cv",
          "first_load_peak_memory_mb_cv",
          "warm_load_time_ms_cv",
        ]),
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
  /**
   * Optional. Override AI Hub input shapes per named input.
   *
   * For text models like MiniLM / BERT-family, try:
   *   `{ input_ids: { shape: [1, 128], dtype: "int64" }, attention_mask: { shape: [1, 128], dtype: "int64" } }`
   *
   * For image models (e.g. MobileNet) the backend auto-detects static shapes
   * from the ONNX file — omit this field.
   *
   * Omit entirely to let EdgeGate auto-detect from the ONNX file (works for most
   * models including image classification, BERT-family, MiniLM).
   */
  input_specs: z
    .record(
      z.string(),
      z.object({
        shape: z
          .array(z.number().int().positive())
          .min(1)
          .max(8)
          .describe("Tensor shape (1–8 positive integers)"),
        dtype: z
          .enum(["float32", "float16", "int64", "int32", "bool"])
          .default("float32")
          .describe("Element dtype"),
      })
    )
    .optional()
    .describe(
      "Optional. Override AI Hub input shapes per named input. " +
        'For text models like MiniLM, try `{input_ids: {shape: [1, 128], dtype: "int64"}, ' +
        'attention_mask: {shape: [1, 128], dtype: "int64"}}`. ' +
        "Omit to let EdgeGate auto-detect from the ONNX file (works for most models " +
        "including image classification, BERT-family, MiniLM)."
    ),
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
      ...(input.input_specs !== undefined ? { input_specs: input.input_specs } : {}),
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
