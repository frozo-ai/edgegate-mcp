/**
 * Saved workflow endpoints via MCP.
 *
 * These tools exist because 0.20.0 shipped tool descriptions referencing
 * `edgegate_list_workflow_endpoints` — which did not exist. The consequence was
 * functional, not cosmetic: with no endpoint CRUD, `endpoint_id` was
 * unreachable, so an agent could only inline an `http` descriptor, and an
 * inline descriptor is rejected (422) when it carries a credential. An
 * authenticated n8n endpoint was ungateable through MCP entirely.
 *
 * The load-bearing assertion here is the secret one: the credential goes UP in
 * the create body and must never come back DOWN in any tool output.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import {
  createWorkflowEndpointHandler,
  createWorkflowEndpointInputSchema,
  listWorkflowEndpointsHandler,
  probeWorkflowEndpointHandler,
} from "../../src/tools/workflow_endpoints.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const epId = "44444444-4444-4444-4444-444444444444";
const SECRET = "n8n-bearer-secret-value";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const client = () => new EdgeGateClient({ apiUrl, apiKey });

describe("create_workflow_endpoint", () => {
  it("sends the secret up but never echoes it back", async () => {
    let sent: Record<string, unknown> = {};
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/workflow-endpoints`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        // Mirrors the backend: has_secret + last4 only, never the value.
        return HttpResponse.json({
          id: epId,
          name: "support workflow",
          endpoint_url: "https://n8n.example.com/webhook/support",
          transport: "webhook",
          has_secret: true,
          secret_last4: "alue",
        });
      })
    );
    const r = await createWorkflowEndpointHandler(client(), {
      workspace_id: wsId,
      name: "support workflow",
      endpoint_url: "https://n8n.example.com/webhook/support",
      transport: "webhook",
      request_template: { chatInput: "{{prompt}}" },
      response_text_path: "reply",
      secret: SECRET,
    });

    expect(sent.secret).toBe(SECRET);
    const text = JSON.stringify(r);
    expect(text).not.toContain(SECRET);
    expect(text).toContain(epId);
  });

  it("rejects a non-URL endpoint before any network call", () => {
    const parsed = createWorkflowEndpointInputSchema.safeParse({
      workspace_id: wsId,
      name: "x",
      endpoint_url: "not-a-url",
    });
    expect(parsed.success).toBe(false);
  });

  it("surfaces the egress refusal as actionable text", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/workflow-endpoints`, () =>
        HttpResponse.json(
          { detail: "endpoint_url resolves to a private address" },
          { status: 422 }
        )
      )
    );
    const r = await createWorkflowEndpointHandler(client(), {
      workspace_id: wsId,
      name: "bad",
      endpoint_url: "http://10.0.0.5/hook",
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).toContain("private address");
  });
});

describe("list_workflow_endpoints", () => {
  it("lists ids to feed into capture and run, without the secret", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/workflow-endpoints`, () =>
        HttpResponse.json([
          {
            id: epId,
            name: "support workflow",
            endpoint_url: "https://n8n.example.com/webhook/support",
            transport: "webhook",
            has_secret: true,
            secret_last4: "alue",
            response_text_path: "reply",
          },
        ])
      )
    );
    const r = await listWorkflowEndpointsHandler(client(), { workspace_id: wsId });
    const text = JSON.stringify(r);
    expect(text).toContain(epId);
    expect(text).not.toContain(SECRET);
  });

  it("tells the agent how to create one when none exist", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/workflow-endpoints`, () => HttpResponse.json([]))
    );
    const r = await listWorkflowEndpointsHandler(client(), { workspace_id: wsId });
    expect(JSON.stringify(r)).toContain("edgegate_create_workflow_endpoint");
  });
});

describe("probe_workflow_endpoint", () => {
  it("warns loudly when extraction came back empty", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/workflow-endpoints/${epId}/probe`, () =>
        HttpResponse.json({
          ok: true,
          extracted_text: "",
          tool_calls: [],
          raw_response: '{"output":"hi"}',
          raw: {},
        })
      )
    );
    const r = await probeWorkflowEndpointHandler(client(), {
      workspace_id: wsId,
      endpoint_id: epId,
    });
    const text = JSON.stringify(r);
    // An empty extraction scores as a refusal downstream, which would make
    // every later gate pass trivially. The probe is the only place to catch it.
    expect(text).toContain("EMPTY");
    expect(text).toContain("response_text_path");
  });

  it("shows the extracted reply when extraction worked", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/workflow-endpoints/${epId}/probe`, () =>
        HttpResponse.json({
          ok: true,
          extracted_text: "Order 10428 shipped on Tuesday.",
          tool_calls: [],
          raw_response: '{"reply":"Order 10428 shipped on Tuesday."}',
          raw: {},
        })
      )
    );
    const r = await probeWorkflowEndpointHandler(client(), {
      workspace_id: wsId,
      endpoint_id: epId,
    });
    expect(r.isError).toBeUndefined();
    expect(JSON.stringify(r)).toContain("Order 10428 shipped");
  });
});
