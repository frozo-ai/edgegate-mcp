import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { setupWorkspaceHandler } from "../../src/tools/setup_workspace.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_xxx";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

describe("setup_workspace tool", () => {
  it("lists workspaces when no workspace_id given", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces`, () =>
        HttpResponse.json([
          { id: "w1", name: "Mobile Team", owner_id: "u", plan: "pro" },
          { id: "w2", name: "Edge Team", owner_id: "u", plan: "team" },
        ])
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await setupWorkspaceHandler(client, {});
    expect(result.content[0].text).toContain("Mobile Team");
    expect(result.content[0].text).toContain("w1");
  });

  it("confirms a specific workspace when given workspace_id", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/w1`, () =>
        HttpResponse.json({ id: "w1", name: "Mobile Team", owner_id: "u", plan: "pro" })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await setupWorkspaceHandler(client, { workspace_id: "w1" });
    expect(result.content[0].text).toContain("Mobile Team");
    expect(result.content[0].text).toContain("pro");
  });

  it("returns a friendly error on 401", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces`, () =>
        HttpResponse.json({ detail: "Invalid token" }, { status: 401 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await setupWorkspaceHandler(client, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/EDGEGATE_API_KEY|invalid|401/i);
  });

  it("renders '(unknown)' when the workspace has no plan field", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces`, () =>
        HttpResponse.json([{ id: "w1", name: "Legacy Workspace" }])
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await setupWorkspaceHandler(client, {});
    expect(result.content[0].text).toContain("Legacy Workspace");
    expect(result.content[0].text).toContain("(unknown)");
    expect(result.content[0].text).not.toContain("undefined");
  });
});
