import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import {
  predictNpuCoverageHandler,
  predictNpuCoverageInputSchema,
} from "../../src/tools/predict_npu_coverage.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const artifactId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const path = `${apiUrl}/v1/workspaces/${wsId}/artifacts/${artifactId}/predict-npu-coverage`;

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("happy path", () => {
  it("renders both coverage numbers, risk, divergence callout, fixes, and version", async () => {
    server.use(
      http.post(path, () =>
        HttpResponse.json({
          total_ops: 3,
          npu_ops: 2,
          cpu_ops: 1,
          conditional_ops: 0,
          predicted_npu_coverage: 66.7,
          compute_weighted_npu_coverage: 97.0,
          compute_weighted: true,
          cpu_fallback_ops: [
            { op_type: "TopK", reason: "Not supported on Hexagon NPU", recommendation: "Move to post-processing", compute_pct: 3.0 },
          ],
          recommendations: [{ op: "TopK", fix: "Move to post-processing pipeline." }],
          model_name: "mobilenet.onnx",
          risk_level: "low",
          summary: "1 of 3 ops fall back to CPU, but they're only ~3% of estimated compute.",
          op_table_version: "QAIRT 2.45 · Hexagon HTP · Snapdragon 8 Gen 1+ (SM8450+)",
        })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await predictNpuCoverageHandler(client, {
      workspace_id: wsId,
      artifact_id: artifactId,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("97%"); // compute-weighted
    expect(text).toContain("66.7%"); // op-count
    expect(text).toMatch(/LOW/);
    expect(text).toMatch(/cheap paths/i); // divergence callout (compute > count)
    expect(text).toContain("TopK");
    expect(text).toContain("QAIRT 2.45");
  });
});

describe("non-ONNX artifact (400)", () => {
  it("returns isError with an ONNX-only message", async () => {
    server.use(
      http.post(path, () =>
        HttpResponse.json(
          { detail: "Got: model.tflite" },
          { status: 400 }
        )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await predictNpuCoverageHandler(client, {
      workspace_id: wsId,
      artifact_id: artifactId,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/only supports ONNX/i);
  });
});

describe("schema", () => {
  it("rejects a non-uuid artifact_id with no network call", () => {
    const parsed = predictNpuCoverageInputSchema.safeParse({
      workspace_id: wsId,
      artifact_id: "not-a-uuid",
    });
    expect(parsed.success).toBe(false);
  });
});
