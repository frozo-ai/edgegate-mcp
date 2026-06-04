import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../src/client.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_aBcDeFg1234567890";
const wsId = "11111111-1111-1111-1111-111111111111";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

describe("EdgeGateClient", () => {
  it("sends the API key as a Bearer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ id: wsId, name: "Test", owner_id: "u", plan: "pro" });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    await client.getWorkspace(wsId);
    expect(seenAuth).toBe(`Bearer ${apiKey}`);
  });

  it("sends the User-Agent header", async () => {
    let seenUA: string | null = null;
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}`, ({ request }) => {
        seenUA = request.headers.get("user-agent");
        return HttpResponse.json({ id: wsId, name: "T", owner_id: "u", plan: "pro" });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    await client.getWorkspace(wsId);
    expect(seenUA).toMatch(/^edgegate-mcp\//);
  });

  it("throws EdgeGateError with status on 4xx", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}`, () =>
        HttpResponse.json({ detail: "Workspace not found" }, { status: 404 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    await expect(client.getWorkspace(wsId)).rejects.toThrow(/404/);
  });

  it("retries idempotent GETs on 5xx (max 2 retries)", async () => {
    let calls = 0;
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}`, () => {
        calls++;
        if (calls < 3) return HttpResponse.json({ detail: "boom" }, { status: 503 });
        return HttpResponse.json({ id: wsId, name: "T", owner_id: "u", plan: "pro" });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey, retryDelayMs: 0 });
    const ws = await client.getWorkspace(wsId);
    expect(calls).toBe(3);
    expect(ws.id).toBe(wsId);
  });

  it("does NOT retry POSTs (non-idempotent)", async () => {
    let calls = 0;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/api-keys`, () => {
        calls++;
        return HttpResponse.json({ detail: "boom" }, { status: 503 });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey, retryDelayMs: 0 });
    await expect(client.createAPIKey(wsId, { name: "x" })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
