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
