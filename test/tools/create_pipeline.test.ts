import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import {
  createPipelineHandler,
  createPipelineInputSchema,
} from "../../src/tools/create_pipeline.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

const mockPipelineResponse = {
  id: "p1",
  name: "MobileNet Gates",
  device_count: 2,
  model_count: 1,
  gate_count: 1,
  cell_count: 2,
  promptpack_id: "image-classification-bench-v1",
  promptpack_version: "1.0.0",
  created_at: "2026-06-05T05:00:00Z",
  updated_at: "2026-06-05T05:00:00Z",
  last_run: null,
};

describe("create_pipeline tool", () => {
  it("translates devices to device_matrix and operator symbols to API enums", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(mockPipelineResponse, { status: 201 });
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "MobileNet Gates",
      promptpack_id: "image-classification-bench-v1",
      promptpack_version: "1.0.0",
      devices: ["Samsung Galaxy S24 (Family)", "Samsung Galaxy S23 (Family)"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("p1");
    expect(result.content[0].text).toContain("MobileNet Gates");
    // Verify the translation happened correctly
    expect(receivedBody).toMatchObject({
      name: "MobileNet Gates",
      device_matrix: [
        { name: "Samsung Galaxy S24 (Family)", enabled: true },
        { name: "Samsung Galaxy S23 (Family)", enabled: true },
      ],
      promptpack_ref: {
        promptpack_id: "image-classification-bench-v1",
        version: "1.0.0",
      },
      gates: [{ metric: "inference_time_ms", operator: "lte", threshold: 10 }],
    });
  });

  it("translates all operator symbols correctly", async () => {
    const capturedGates: unknown[] = [];
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        const body = (await request.json()) as { gates: unknown[] };
        capturedGates.push(...body.gates);
        return HttpResponse.json({ ...mockPipelineResponse, gate_count: 5 }, { status: 201 });
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "Operator test",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [
        { metric: "inference_time_ms", operator: "<=", threshold: 1 },
        { metric: "inference_time_ms", operator: "<", threshold: 2 },
        { metric: "peak_memory_mb", operator: ">=", threshold: 3 },
        { metric: "peak_memory_mb", operator: ">", threshold: 4 },
        { metric: "inference_time_ms", operator: "==", threshold: 5 },
      ],
    });

    expect(capturedGates).toMatchObject([
      { operator: "lte" },
      { operator: "lt" },
      { operator: "gte" },
      { operator: "gt" },
      { operator: "eq" },
    ]);
  });

  it("includes model_matrix when models are provided", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ ...mockPipelineResponse, model_count: 1 }, { status: 201 });
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "Multi-model",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      models: [{ name: "MobileNetV2", artifact_id: "art-1" }],
    });

    expect(receivedBody).toMatchObject({
      model_matrix: [{ artifact_id: "art-1", label: "MobileNetV2" }],
    });
  });

  it("omits model_matrix when models not provided (legacy single-model mode)", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(mockPipelineResponse, { status: 201 });
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "Single-model",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
    });

    expect((receivedBody as Record<string, unknown>).model_matrix).toBeUndefined();
  });

  it("accepts every gate metric the backend's VALID_METRICS supports", async () => {
    // Regression: the MCP enum used to be {inference_time_ms, peak_memory_mb,
    // throughput_tps} — missing the compute-unit split (npu/gpu/cpu_compute_percent)
    // and the LLM metrics (ttft_ms, tps), plus `throughput_tps` was a
    // legacy name the backend never accepted. This test pins the contract
    // to exactly the seven metrics in edgegate.services.pipeline.VALID_METRICS.
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(mockPipelineResponse, { status: 201 });
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "All-gate-types",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [
        { metric: "inference_time_ms", operator: "<=", threshold: 10 },
        { metric: "peak_memory_mb", operator: "<=", threshold: 500 },
        { metric: "npu_compute_percent", operator: ">=", threshold: 70 },
        { metric: "gpu_compute_percent", operator: "<=", threshold: 30 },
        { metric: "cpu_compute_percent", operator: "<=", threshold: 20 },
        { metric: "ttft_ms", operator: "<=", threshold: 1500 },
        { metric: "tps", operator: ">=", threshold: 10 },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect((receivedBody as Record<string, unknown>).gates).toHaveLength(7);
  });

  it("rejects the legacy throughput_tps metric at the schema level (renamed to tps)", async () => {
    // The MCP protocol layer validates input via the input schema before
    // invoking the handler, so test the schema directly. Backend's
    // VALID_METRICS uses `tps`, never `throughput_tps`.
    const result = createPipelineInputSchema.safeParse({
      workspace_id: wsId,
      name: "Legacy throughput_tps",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "throughput_tps", operator: ">=", threshold: 10 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown metrics not in VALID_METRICS", async () => {
    const result = createPipelineInputSchema.safeParse({
      workspace_id: wsId,
      name: "Made-up metric",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "fps", operator: ">=", threshold: 30 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts the 3 Plan B LLM metrics added 2026-06-15", async () => {
    // Regression: response_rate_tps + ttft_min_ms + ttft_max_ms were
    // added to backend VALID_METRICS in commit 7dd0691 but missing from
    // the MCP enum until v0.11.0.
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(mockPipelineResponse, { status: 201 });
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "LLM Plan-B metrics",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [
        { metric: "response_rate_tps", operator: ">=", threshold: 25 },
        { metric: "ttft_min_ms", operator: "<=", threshold: 800 },
        { metric: "ttft_max_ms", operator: "<=", threshold: 2000 },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect((receivedBody as Record<string, unknown>).gates).toHaveLength(3);
  });

  it("accepts a model entry with llm_compile_source (Plan B)", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ ...mockPipelineResponse, model_count: 1 }, { status: 201 });
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const srcA = "44444444-4444-4444-4444-444444444444";
    const srcB = "55555555-5555-5555-5555-555555555555";
    const srcC = "66666666-6666-6666-6666-666666666666";

    const result = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "Llama-1B auto-compile",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "ttft_ms", operator: "<=", threshold: 1500 }],
      models: [
        {
          name: "Llama-1B",
          llm_compile_source: {
            source_artifact_ids: [srcA, srcB, srcC],
            roles: ["prompt", "token", "kv_cache"],
            sequence_lengths: [128, 1],
            context_lengths: [4096],
            target_runtime: "genie",
          },
        },
      ],
    });

    expect(result.isError).toBeUndefined();
    // Confirm the body has llm_compile_source and no artifact_id on that entry
    const body = receivedBody as { model_matrix: Array<Record<string, unknown>> };
    expect(body.model_matrix).toHaveLength(1);
    expect(body.model_matrix[0]).toHaveProperty("llm_compile_source");
    expect(body.model_matrix[0]).not.toHaveProperty("artifact_id");
    expect(body.model_matrix[0].label).toBe("Llama-1B");
    expect((body.model_matrix[0].llm_compile_source as Record<string, unknown>).source_artifact_ids).toEqual([
      srcA,
      srcB,
      srcC,
    ]);
  });

  it("rejects a model entry with BOTH artifact_id and llm_compile_source (mutual exclusion)", () => {
    const srcA = "44444444-4444-4444-4444-444444444444";
    const parsed = createPipelineInputSchema.safeParse({
      workspace_id: wsId,
      name: "Conflicted model",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      models: [
        {
          name: "Conflict",
          artifact_id: "art-1",
          llm_compile_source: { source_artifact_ids: [srcA] },
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toMatch(/exactly one|artifact_id|llm_compile_source/i);
    }
  });

  it("rejects a model entry with NEITHER artifact_id nor llm_compile_source", () => {
    const parsed = createPipelineInputSchema.safeParse({
      workspace_id: wsId,
      name: "Empty model",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      models: [{ name: "Empty" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a 25+ cell matrix client-side (multi-model)", async () => {
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "Too big",
      promptpack_id: "bench-v1",
      devices: Array.from({ length: 5 }, (_, i) => `d${i}`),
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      models: Array.from({ length: 6 }, (_, i) => ({ name: `m${i}`, artifact_id: `a${i}` })),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/25|cells|matrix/i);
  });
});
