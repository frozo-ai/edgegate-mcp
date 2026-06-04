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

describe("check_status tool", () => {
  it("formats passed runs with metrics", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r1`, () =>
        HttpResponse.json({
          id: "r1", workspace_id: wsId, pipeline_id: "p1", status: "passed",
          started_at: "2026-06-04T18:00:00Z", completed_at: "2026-06-04T18:05:00Z",
          trigger: "mcp",
          cells: [{
            model_artifact_id: "a", device_name: "Samsung Galaxy S24 (Family)",
            metrics: { inference_time_ms: 8.4, peak_memory_mb: 130 },
            gate_results: [{ metric: "inference_time_ms", passed: true, threshold: 10, actual: 8.4 }],
          }],
          evidence_bundle_url: null,
        })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkStatusHandler(client, { workspace_id: wsId, run_id: "r1" });
    expect(result.content[0].text).toContain("PASSED");
    expect(result.content[0].text).toContain("Samsung Galaxy S24");
    expect(result.content[0].text).toContain("8.4");
  });

  it("formats failed runs with the violating gate", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r2`, () =>
        HttpResponse.json({
          id: "r2", workspace_id: wsId, pipeline_id: "p1", status: "failed",
          started_at: "2026-06-04T18:00:00Z", completed_at: "2026-06-04T18:05:00Z",
          trigger: "mcp",
          cells: [{
            model_artifact_id: "a", device_name: "Samsung Galaxy S23 (Family)",
            metrics: { inference_time_ms: 14.2, peak_memory_mb: 130 },
            gate_results: [{ metric: "inference_time_ms", passed: false, threshold: 10, actual: 14.2 }],
          }],
          evidence_bundle_url: "https://artifacts.example/bundle.tgz",
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
