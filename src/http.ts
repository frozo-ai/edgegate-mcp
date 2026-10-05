/**
 * Hosted (remote) transport: MCP Streamable HTTP over Web-standard
 * Request/Response, so web clients — claude.ai, chatgpt.com — can connect
 * without installing anything. Mount `handleMcpRequest` on any runtime that
 * speaks fetch (a Next.js route handler, Workers, Hono, …).
 *
 * Auth: this endpoint is an OAuth protected resource. It holds no credentials
 * of its own — the caller's bearer token is forwarded to the EdgeGate API,
 * which is the only thing that decides what the token may do. Both OAuth access
 * tokens and `egk_` API keys work, because the API accepts both.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { EdgeGateClient } from "./client.js";
import { createServer, DEFAULT_API_URL } from "./server.js";
import { USER_AGENT } from "./version.js";

export interface HttpOptions {
  /** Public URL of this MCP endpoint, e.g. `https://edgegate.frozo.ai/mcp`. */
  resourceUrl: string;
  /** EdgeGate API base URL. Also the OAuth issuer unless overridden. */
  apiUrl?: string;
  /** OAuth authorization server issuer. Defaults to `apiUrl`. */
  authorizationServer?: string;
}

// No cookies are involved — the bearer token is the only credential — so a
// wildcard origin is safe and lets browser-based MCP clients connect.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
  });
}

function rpcError(code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function apiUrlOf(opts: HttpOptions): string {
  return (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
}

/** RFC 9728 metadata URL for a resource: the well-known segment goes before the path. */
export function protectedResourceMetadataUrl(resourceUrl: string): string {
  const u = new URL(resourceUrl);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.origin}/.well-known/oauth-protected-resource${path}`;
}

/** RFC 9728 Protected Resource Metadata — tells clients where to get a token. */
export function protectedResourceMetadata(opts: HttpOptions): Record<string, unknown> {
  return {
    resource: opts.resourceUrl,
    authorization_servers: [(opts.authorizationServer ?? apiUrlOf(opts)).replace(/\/$/, "")],
    bearer_methods_supported: ["header"],
    scopes_supported: ["edgegate"],
    resource_name: "EdgeGate",
    resource_documentation: "https://edgegate.frozo.ai/docs/mcp",
  };
}

type TokenCheck = "ok" | "invalid" | "unavailable";

// ponytail: one /v1/auth/me round-trip per MCP request, no cache. Add a short
// TTL cache keyed by token hash if the extra hop ever shows up in latency.
async function checkToken(token: string, apiUrl: string): Promise<TokenCheck> {
  try {
    const res = await fetch(`${apiUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "ok";
    // Only a definite credential rejection may trigger the client's re-auth
    // flow. An API outage answered with 401 would make every connected client
    // throw away a perfectly good token.
    return res.status === 401 || res.status === 403 ? "invalid" : "unavailable";
  } catch {
    return "unavailable";
  }
}

function unauthorized(opts: HttpOptions, hadToken: boolean): Response {
  const challenge =
    `Bearer resource_metadata="${protectedResourceMetadataUrl(opts.resourceUrl)}"` +
    (hadToken ? `, error="invalid_token"` : "");
  return json(rpcError(-32001, "Authentication required"), 401, {
    "WWW-Authenticate": challenge,
  });
}

/** Handle one MCP request. Stateless: every request stands alone. */
export async function handleMcpRequest(req: Request, opts: HttpOptions): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  const token = match?.[1]?.trim();
  if (!token) return unauthorized(opts, false);

  const apiUrl = apiUrlOf(opts);
  const check = await checkToken(token, apiUrl);
  if (check === "invalid") return unauthorized(opts, true);
  if (check === "unavailable") {
    return json(rpcError(-32000, "EdgeGate API is temporarily unavailable"), 503, {
      "Retry-After": "5",
    });
  }

  // No server-initiated streams in stateless mode, so GET (SSE) and DELETE
  // (session teardown) have nothing to act on.
  if (req.method !== "POST") {
    return json(rpcError(-32000, "Method not allowed"), 405, { Allow: "POST, OPTIONS" });
  }

  const server = createServer(() => new EdgeGateClient({ apiUrl, apiKey: token }), {
    remote: true,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } finally {
    // JSON mode resolves only once the reply is fully built, so it is safe to
    // release the per-request server here.
    void server.close();
  }
}
