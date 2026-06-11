/**
 * Cross-repo contract drift detection.
 *
 * The MCP's Zod schemas (gate metrics, gate operators) must match the
 * backend's allow-lists exactly. This file pins the contract IN BOTH
 * DIRECTIONS:
 *
 *   1. Every metric the MCP advertises is in the backend's VALID_METRICS.
 *      If the MCP grows a new option, the backend test catches the drift.
 *
 *   2. Every metric the backend supports is exposed by the MCP.
 *      If the backend grows a new option, the MCP test catches the drift.
 *
 * The backend source-of-truth is the live `GET /v1/_contracts` endpoint
 * which serves `edgegate.services.pipeline.VALID_METRICS` + VALID_OPERATORS.
 * We mock it here for unit-test speed; an integration job in CI should
 * hit the real endpoint instead.
 *
 * Bug this prevents: the MCP shipped `throughput_tps` for months — the
 * backend never accepted it. And was missing 5 metrics the backend
 * supported (npu/gpu/cpu_compute_percent + ttft_ms + tps). Customers
 * silently couldn't use compute-unit fallback detection — the headline
 * EdgeGate feature.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPipelineInputSchema } from "../src/tools/create_pipeline.js";

// What the live backend's GET /v1/_contracts endpoint returns at the time
// this test is committed. Update this fixture in lock-step with the
// edgegate-mcp release that follows a backend contract change. The unit
// test below asserts the MCP schemas match — a CI integration step
// (separate concern) hits the live endpoint and asserts this fixture is
// still current.
const BACKEND_CONTRACT_FIXTURE = {
  valid_gate_metrics: [
    // Phase 0 — original 7
    "cpu_compute_percent",
    "gpu_compute_percent",
    "inference_time_ms",
    "npu_compute_percent",
    "peak_memory_mb",
    "tps",
    "ttft_ms",
    // Phase 1 (2026-06-11) — schema-verified AI Hub fields
    "compile_time_ms",
    "compile_peak_memory_mb",
    "first_load_time_ms",
    "first_load_peak_memory_mb",
    "warm_load_time_ms",
    // Phase 2a — layer-count composition
    "cpu_layer_count",
    "cpu_layer_percent",
    "gpu_layer_count",
    "gpu_layer_percent",
    "npu_layer_count",
    "npu_layer_percent",
    "total_layer_count",
    // Phase 2b — CV variants (computed by backend aggregator as
    // `{source_metric}_cv`, preserving unit suffix).
    "compile_peak_memory_mb_cv",
    "compile_time_ms_cv",
    "cpu_compute_percent_cv",
    "first_load_peak_memory_mb_cv",
    "first_load_time_ms_cv",
    "gpu_compute_percent_cv",
    "inference_time_ms_cv",
    "npu_compute_percent_cv",
    "peak_memory_mb_cv",
    "warm_load_time_ms_cv",
  ],
  valid_gate_operators: ["eq", "gt", "gte", "lt", "lte"],
  run_statuses_terminal: ["error", "failed", "passed"],
  run_statuses_in_flight: [
    "collecting",
    "evaluating",
    "preparing",
    "queued",
    "reporting",
    "running",
    "submitting",
  ],
};

// Extract the metric enum from the MCP's create_pipeline schema. Walks
// the Zod tree because the schema is built compositionally and we don't
// want to hand-maintain a second copy.
function getMcpMetricEnum(): string[] {
  const shape = (createPipelineInputSchema as unknown as z.AnyZodObject).shape;
  const gatesSchema = shape.gates as z.ZodArray<z.ZodObject<{ metric: z.ZodEnum<[string, ...string[]]> }>>;
  const gateMetric = gatesSchema.element.shape.metric;
  return [...gateMetric.options].sort();
}

describe("MCP ↔ backend contract", () => {
  it("MCP gate metric enum matches backend VALID_METRICS exactly", () => {
    const mcpMetrics = getMcpMetricEnum();
    const backendMetrics = [...BACKEND_CONTRACT_FIXTURE.valid_gate_metrics].sort();

    // Bidirectional check — neither side can drift.
    expect(mcpMetrics).toEqual(backendMetrics);
  });

  it("MCP has no extraneous metrics that the backend would reject", () => {
    const mcpMetrics = getMcpMetricEnum();
    const backendSet = new Set(BACKEND_CONTRACT_FIXTURE.valid_gate_metrics);
    const extraneous = mcpMetrics.filter((m) => !backendSet.has(m));
    expect(
      extraneous,
      `MCP advertises metrics the backend rejects: ${extraneous.join(", ")}. ` +
        `Backend will return 400 when any of these is used.`,
    ).toEqual([]);
  });

  it("MCP exposes every metric the backend supports", () => {
    const mcpSet = new Set(getMcpMetricEnum());
    const missing = BACKEND_CONTRACT_FIXTURE.valid_gate_metrics.filter(
      (m) => !mcpSet.has(m),
    );
    expect(
      missing,
      `Backend supports metrics not exposed by the MCP: ${missing.join(", ")}. ` +
        `Customers can't use these via MCP — UX gap, not a backend bug.`,
    ).toEqual([]);
  });

  it("includes the killer NPU/GPU/CPU fallback-detection metrics", () => {
    // The headline EdgeGate feature: catching silent NPU→GPU/CPU fallback
    // on chip refresh. These metrics MUST be reachable via every client.
    const mcpMetrics = getMcpMetricEnum();
    expect(mcpMetrics).toContain("npu_compute_percent");
    expect(mcpMetrics).toContain("gpu_compute_percent");
    expect(mcpMetrics).toContain("cpu_compute_percent");
  });
});
