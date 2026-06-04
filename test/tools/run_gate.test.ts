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

describe("run_gate tool", () => {
  it("triggers a run and returns the run_id", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines/p1/runs`, () =>
        HttpResponse.json(
          {
            id: "r1", workspace_id: wsId, pipeline_id: "p1", status: "pending",
            started_at: null, completed_at: null, trigger: "mcp",
          },
          { status: 201 }
        )
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await runGateHandler(client, { workspace_id: wsId, pipeline_id: "p1" });
    expect(result.content[0].text).toContain("r1");
    expect(result.content[0].text).toMatch(/edgegate_check_status/i);
  });

  it("explains workspace-concurrency 409 specifically", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines/p1/runs`, () =>
        HttpResponse.json({ detail: "concurrent run" }, { status: 409 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await runGateHandler(client, { workspace_id: wsId, pipeline_id: "p1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/workspace_concurrency|in flight/i);
  });
});
