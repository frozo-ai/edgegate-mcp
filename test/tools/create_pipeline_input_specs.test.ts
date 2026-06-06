import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { createPipelineHandler, createPipelineInputSchema } from "../../src/tools/create_pipeline.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

const mockPipelineResponse = {
  id: "p-specs",
  name: "BERT Gate",
  device_count: 1,
  model_count: 0,
  gate_count: 1,
  cell_count: 1,
  promptpack_id: "bert-bench-v1",
  promptpack_version: "1.0.0",
  created_at: "2026-06-05T05:00:00Z",
  updated_at: "2026-06-05T05:00:00Z",
  last_run: null,
};

describe("create_pipeline — input_specs", () => {
  it("forwards input_specs to the API when provided", async () => {
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
      name: "BERT Gate",
      promptpack_id: "bert-bench-v1",
      promptpack_version: "1.0.0",
      devices: ["Samsung Galaxy S24 (Family)"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      input_specs: {
        input_ids: { shape: [1, 128], dtype: "int64" },
        attention_mask: { shape: [1, 128], dtype: "int64" },
      },
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("BERT Gate");

    // Verify the API received the input_specs
    const body = receivedBody as Record<string, unknown>;
    expect(body.input_specs).toEqual({
      input_ids: { shape: [1, 128], dtype: "int64" },
      attention_mask: { shape: [1, 128], dtype: "int64" },
    });
  });

  it("omits input_specs from the request body when not provided (backwards compat)", async () => {
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
      name: "No-specs pipe",
      promptpack_id: "bench-v1",
      devices: ["Samsung Galaxy S24 (Family)"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
    });

    const body = receivedBody as Record<string, unknown>;
    // input_specs must be absent so the backend's auto-resolve fires
    expect(body.input_specs).toBeUndefined();
  });

  it("rejects a shape that is too large (> 8 dims) at the zod layer", () => {
    const result = createPipelineInputSchema.safeParse({
      workspace_id: wsId,
      name: "Bad shape",
      promptpack_id: "bench-v1",
      devices: ["Samsung Galaxy S24 (Family)"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      input_specs: {
        x: { shape: [1, 2, 3, 4, 5, 6, 7, 8, 9], dtype: "float32" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid dtype at the zod layer", () => {
    const result = createPipelineInputSchema.safeParse({
      workspace_id: wsId,
      name: "Bad dtype",
      promptpack_id: "bench-v1",
      devices: ["Samsung Galaxy S24 (Family)"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      input_specs: {
        x: { shape: [1, 128], dtype: "bfloat16" },
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid dtypes", () => {
    const dtypes = ["float32", "float16", "int64", "int32", "bool"] as const;
    for (const dtype of dtypes) {
      const result = createPipelineInputSchema.safeParse({
        workspace_id: wsId,
        name: `Dtype test ${dtype}`,
        promptpack_id: "bench-v1",
        devices: ["d1"],
        gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
        input_specs: { x: { shape: [1, 128], dtype } },
      });
      expect(result.success, `dtype "${dtype}" should be valid`).toBe(true);
    }
  });

  it("defaults dtype to float32 when omitted from input_specs entry", () => {
    const result = createPipelineInputSchema.safeParse({
      workspace_id: wsId,
      name: "Default dtype",
      promptpack_id: "bench-v1",
      devices: ["d1"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
      input_specs: {
        pixel_values: { shape: [1, 3, 224, 224] },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.input_specs?.pixel_values.dtype).toBe("float32");
    }
  });
});
