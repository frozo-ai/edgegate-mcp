import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { runGateHandler } from "../../src/tools/run_gate.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

const mockRunResponse = {
  id: "r1",
  pipeline_id: "p1",
  pipeline_name: "test-pipeline",
  status: "pending",
  trigger: "manual",
  model_artifact_id: null,
  model_filename: null,
  error_code: null,
  error_detail: null,
  created_at: "2026-06-05T05:00:00Z",
  updated_at: "2026-06-05T05:00:00Z",
  completed_at: null,
  hub_model_id: null,
  hub_job_id: null,
};

describe("run_gate tool", () => {
  it("POSTs to /workspaces/{id}/runs with pipeline_id in body and returns run_id", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/runs`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(mockRunResponse, { status: 202 });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await runGateHandler(client, { workspace_id: wsId, pipeline_id: "p1" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("r1");
    expect(result.content[0].text).toMatch(/edgegate_check_status/i);
    expect(receivedBody).toMatchObject({ pipeline_id: "p1", trigger: "manual" });
  });

  it("passes model_artifact_id when provided", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/runs`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          { ...mockRunResponse, model_artifact_id: "art-1" },
          { status: 202 }
        );
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    await runGateHandler(client, {
      workspace_id: wsId,
      pipeline_id: "p1",
      model_artifact_id: "22222222-2222-2222-2222-222222222222",
    });
    expect(receivedBody).toMatchObject({
      pipeline_id: "p1",
      model_artifact_id: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("explains workspace-concurrency 409 specifically", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/runs`, () =>
        HttpResponse.json({ detail: "concurrent run" }, { status: 409 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await runGateHandler(client, { workspace_id: wsId, pipeline_id: "p1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/workspace_concurrency|in flight/i);
  });
});
