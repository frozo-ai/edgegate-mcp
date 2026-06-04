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

describe("get_audit_report tool", () => {
  it("returns the signed audit report URL", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r1/audit-report`, () =>
        HttpResponse.json({
          url: "https://artifacts.example/audit-r1.pdf",
          generated_at: "2026-06-04T18:05:00Z",
        })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await getAuditReportHandler(client, { workspace_id: wsId, run_id: "r1" });
    expect(result.content[0].text).toContain("https://artifacts.example/audit-r1.pdf");
  });

  it("explains 404 (report not yet generated) clearly", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/r1/audit-report`, () =>
        HttpResponse.json({ detail: "not found" }, { status: 404 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await getAuditReportHandler(client, { workspace_id: wsId, run_id: "r1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/asynchronously|1-2 minutes/);
  });
});
