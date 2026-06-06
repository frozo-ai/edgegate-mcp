import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { createApiKeyHandler } from "../../src/tools/create_api_key.js";
import { revokeApiKeyHandler } from "../../src/tools/revoke_api_key.js";
import { listApiKeysHandler } from "../../src/tools/list_api_keys.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_xxx";
const wsId = "00000000-0000-0000-0000-000000000001";
const keyId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("create_api_key tool", () => {
  it("returns plaintext exactly once with copy-now framing", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/api-keys`, () =>
        HttpResponse.json(
          {
            id: keyId,
            plaintext: "egk_live_supersecretvalueABCDEFG",
            name: "ci-prod",
            prefix: "egk_live_",
            suffix: "DEFG",
            created_at: "2026-06-06T00:00:00Z",
            expires_at: null,
          },
          { status: 201 },
        ),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createApiKeyHandler(client, {
      workspace_id: wsId,
      name: "ci-prod",
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("egk_live_supersecretvalueABCDEFG");
    expect(result.content[0].text).toMatch(/copy this plaintext now/i);
  });

  it("returns 402 upgrade message on plan limit", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/api-keys`, () =>
        HttpResponse.json(
          { detail: "API keys require Pro tier or above" },
          { status: 402 },
        ),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createApiKeyHandler(client, {
      workspace_id: wsId,
      name: "test",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/pro tier|pricing/i);
  });
});

describe("revoke_api_key tool", () => {
  it("returns success on 204", async () => {
    server.use(
      http.delete(
        `${apiUrl}/v1/workspaces/${wsId}/api-keys/${keyId}`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await revokeApiKeyHandler(client, {
      workspace_id: wsId,
      key_id: keyId,
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Revoked");
  });

  it("returns friendly 404 message when key already gone", async () => {
    server.use(
      http.delete(`${apiUrl}/v1/workspaces/${wsId}/api-keys/${keyId}`, () =>
        HttpResponse.json({ detail: "API key not found" }, { status: 404 }),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await revokeApiKeyHandler(client, {
      workspace_id: wsId,
      key_id: keyId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found|already revoked/i);
  });
});

describe("list_api_keys tool", () => {
  it("returns empty-state guidance when no keys exist", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/api-keys`, () =>
        HttpResponse.json([]),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await listApiKeysHandler(client, { workspace_id: wsId });
    expect(result.content[0].text).toMatch(/no api keys/i);
  });

  it("renders a markdown table when keys exist", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/api-keys`, () =>
        HttpResponse.json([
          {
            id: keyId,
            name: "ci-prod",
            prefix: "egk_live_",
            suffix: "DEFG",
            last_used_at: "2026-06-05T10:00:00Z",
            expires_at: null,
            revoked_at: null,
            created_at: "2026-06-01T00:00:00Z",
          },
        ]),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await listApiKeysHandler(client, { workspace_id: wsId });
    expect(result.content[0].text).toContain("ci-prod");
    expect(result.content[0].text).toContain("active");
    expect(result.content[0].text).toContain("|---|");
  });
});
