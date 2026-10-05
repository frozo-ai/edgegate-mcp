import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  handleMcpRequest,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from "../src/http.js";
import { TOOLS } from "../src/server.js";

const apiUrl = "https://api.test";
const opts = { resourceUrl: "https://app.test/mcp", apiUrl };
const wsId = "11111111-1111-1111-1111-111111111111";
const runId = "22222222-2222-2222-2222-222222222222";

const api = setupServer();
beforeEach(() => api.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  api.resetHandlers();
  api.close();
});

/** /v1/auth/me accepts exactly one token, like the real API would. */
function acceptToken(good: string) {
  api.use(
    http.get(`${apiUrl}/v1/auth/me`, ({ request }) =>
      request.headers.get("authorization") === `Bearer ${good}`
        ? HttpResponse.json({ id: "u1", email: "dev@example.test" })
        : HttpResponse.json({ detail: "Invalid token" }, { status: 401 })
    )
  );
}

function rpc(method: string, params: unknown, token?: string): Request {
  return new Request(opts.resourceUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("remote MCP endpoint — auth", () => {
  it("challenges an anonymous request with the resource metadata URL", async () => {
    const res = await handleMcpRequest(rpc("tools/list", {}), opts);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp"'
    );
  });

  it("rejects a token the API does not recognise", async () => {
    acceptToken("good");
    const res = await handleMcpRequest(rpc("tools/list", {}, "stale"), opts);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("answers 503, not 401, when the API is down", async () => {
    // A 401 here would make every connected client discard a valid token.
    api.use(http.get(`${apiUrl}/v1/auth/me`, () => HttpResponse.json({}, { status: 502 })));
    const res = await handleMcpRequest(rpc("tools/list", {}, "good"), opts);
    expect(res.status).toBe(503);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("answers CORS preflight without a token", async () => {
    const res = await handleMcpRequest(new Request(opts.resourceUrl, { method: "OPTIONS" }), opts);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("refuses GET — stateless mode has no server-initiated stream", async () => {
    acceptToken("good");
    const res = await handleMcpRequest(
      new Request(opts.resourceUrl, { headers: { Authorization: "Bearer good" } }),
      opts
    );
    expect(res.status).toBe(405);
  });
});

describe("remote MCP endpoint — protocol", () => {
  it("lists every tool, with read-only hints", async () => {
    acceptToken("good");
    const res = await handleMcpRequest(rpc("tools/list", {}, "good"), opts);
    expect(res.status).toBe(200);
    const body = await res.json();
    const tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> =
      body.result.tools;
    expect(tools).toHaveLength(TOOLS.length);
    const hint = (name: string) => tools.find((t) => t.name === name)?.annotations.readOnlyHint;
    expect(hint("edgegate_list_devices")).toBe(true);
    expect(hint("edgegate_check_status")).toBe(true);
    expect(hint("edgegate_run_gate")).toBe(false);
    expect(hint("edgegate_revoke_api_key")).toBe(false);
  });

  it("calls the API with the caller's own token", async () => {
    acceptToken("good");
    let seen: string | null = null;
    api.use(
      http.get(`${apiUrl}/v1/workspaces`, ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json([]);
      })
    );
    const res = await handleMcpRequest(
      rpc("tools/call", { name: "edgegate_setup_workspace", arguments: {} }, "good"),
      opts
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result.content[0].type).toBe("text");
    expect(seen).toBe("Bearer good");
  });

  it("returns the run report inline instead of writing to the server's disk", async () => {
    acceptToken("good");
    api.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json({ id: runId, status: "running", pipeline_name: "p" })
      )
    );
    const res = await handleMcpRequest(
      rpc(
        "tools/call",
        {
          name: "edgegate_export_run_report",
          arguments: { workspace_id: wsId, run_id: runId, output_path: "/etc/edgegate-pwned.md" },
        },
        "good"
      ),
      opts
    );
    const text: string = (await res.json()).result.content[0].text;
    expect(text).not.toContain("Wrote run report to");
    expect(text).toContain(runId.slice(0, 8));
  });
});

describe("protected resource metadata", () => {
  it("points clients at the EdgeGate API as the authorization server", () => {
    expect(protectedResourceMetadata(opts)).toMatchObject({
      resource: "https://app.test/mcp",
      authorization_servers: ["https://api.test"],
    });
  });

  it("puts the well-known segment before the resource path (RFC 9728)", () => {
    expect(protectedResourceMetadataUrl("https://app.test/mcp")).toBe(
      "https://app.test/.well-known/oauth-protected-resource/mcp"
    );
    expect(protectedResourceMetadataUrl("https://mcp.test/")).toBe(
      "https://mcp.test/.well-known/oauth-protected-resource"
    );
  });
});
