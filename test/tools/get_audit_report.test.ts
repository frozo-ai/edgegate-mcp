import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { getAuditReportHandler } from "../../src/tools/get_audit_report.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

const mockBundle = {
  run_id: "r1",
  status: "passed",
  pipeline_id: "p1",
  pipeline_name: "test-pipeline",
  normalized_metrics: { inference_time_ms: 8.4, peak_memory_mb: 121.5 },
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
};

describe("get_audit_report tool", () => {
  it("returns bundle details with metrics and gate decisions", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r1/bundle`, () =>
        HttpResponse.json(mockBundle)
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await getAuditReportHandler(client, { workspace_id: wsId, run_id: "r1" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("bundle-uuid-1");
    expect(result.content[0].text).toContain("PASSED");
    expect(result.content[0].text).toContain("inference_time_ms");
    expect(result.content[0].text).toContain("8.4");
  });

  it("explains 404 (bundle not yet generated) clearly", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r1/bundle`, () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await getAuditReportHandler(client, { workspace_id: wsId, run_id: "r1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not.*yet|1-2 minutes/i);
  });

  it("explains 409 (run not yet complete) clearly", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r1/bundle`, () =>
        HttpResponse.json(
          { detail: "Evidence bundle not available for running runs" },
          { status: 409 }
        )
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await getAuditReportHandler(client, { workspace_id: wsId, run_id: "r1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not.*complet|PASSED|FAILED/i);
  });
});
