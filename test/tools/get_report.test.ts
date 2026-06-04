import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { getReportHandler } from "../../src/tools/get_report.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

describe("get_report tool", () => {
  it("lists recent runs with status + duration", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs`, () =>
        HttpResponse.json([
          {
            id: "r1", workspace_id: wsId, pipeline_id: "p1", status: "passed",
            started_at: "2026-06-04T18:00:00Z", completed_at: "2026-06-04T18:05:00Z",
            trigger: "ci",
          },
          {
            id: "r2", workspace_id: wsId, pipeline_id: "p1", status: "failed",
            started_at: "2026-06-04T17:00:00Z", completed_at: "2026-06-04T17:04:00Z",
            trigger: "mcp",
          },
        ])
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await getReportHandler(client, { workspace_id: wsId, limit: 5 });
    expect(result.content[0].text).toContain("r1");
    expect(result.content[0].text).toContain("r2");
    expect(result.content[0].text).toContain("passed");
  });
});
