import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { checkStatusHandler } from "../../src/tools/check_status.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

const baseRun = {
  pipeline_id: "p1",
  pipeline_name: "test-pipeline",
  trigger: "manual",
  model_artifact_id: "art-1",
  model_filename: "model.onnx",
  error_code: null,
  error_detail: null,
  created_at: "2026-06-04T18:00:00Z",
  updated_at: "2026-06-04T18:05:00Z",
  completed_at: "2026-06-04T18:05:00Z",
  hub_model_id: "hub-1",
  hub_job_id: "job-1",
};

describe("check_status tool", () => {
  it("formats passed runs with metrics and gate results", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r1`, () =>
        HttpResponse.json({
          ...baseRun,
          id: "r1",
          status: "passed",
          normalized_metrics: { inference_time_ms: 8.4, peak_memory_mb: 130 },
          gates_eval: {
            gates: [
              {
                metric: "inference_time_ms",
                passed: true,
                operator: "lte",
                threshold: 10,
                description: null,
                actual_value: 8.4,
              },
            ],
            passed: true,
          },
          bundle_artifact_id: "bundle-uuid-1",
        })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkStatusHandler(client, { workspace_id: wsId, run_id: "r1" });
    expect(result.content[0].text).toContain("PASSED");
    expect(result.content[0].text).toContain("inference_time_ms");
    expect(result.content[0].text).toContain("8.4");
    expect(result.content[0].text).toContain("bundle-uuid-1");
  });

  it("formats failed runs with the violating gate", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r2`, () =>
        HttpResponse.json({
          ...baseRun,
          id: "r2",
          status: "failed",
          normalized_metrics: { inference_time_ms: 14.2, peak_memory_mb: 130 },
          gates_eval: {
            gates: [
              {
                metric: "inference_time_ms",
                passed: false,
                operator: "lte",
                threshold: 10,
                description: null,
                actual_value: 14.2,
              },
            ],
            passed: false,
          },
          bundle_artifact_id: null,
        })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkStatusHandler(client, { workspace_id: wsId, run_id: "r2" });
    expect(result.content[0].text).toContain("FAILED");
    expect(result.content[0].text).toContain("inference_time_ms");
    expect(result.content[0].text).toContain("14.2");
  });
});
