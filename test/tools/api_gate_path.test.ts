/**
 * The API/workflow gating path (EdgeGate M4) as reached through MCP.
 *
 * Until this landed, an agent driving EdgeGate could not gate an n8n workflow
 * at all: create_bg_run demanded a compiled bundle, and capture_reference knew
 * only two flavors. Pinned here, each with the failure it prevents:
 *
 *  - a bundle is no longer required (an endpoint has none to compile),
 *  - the new fields actually reach the wire — a schema that accepts a param the
 *    handler drops is worse than one that rejects it, because it fails silently,
 *  - endpoint_id and http are refused together, matching the backend's 422,
 *  - the capture XOR counts the http flavor as one branch, not two.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { createBgRunHandler, createBgRunInputSchema } from "../../src/tools/create_bg_run.js";
import {
  captureReferenceHandler,
  captureReferenceInputSchema,
} from "../../src/tools/capture_reference.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const evalSet = "22222222-2222-2222-2222-222222222222";
const reference = "33333333-3333-3333-3333-333333333333";
const endpoint = "44444444-4444-4444-4444-444444444444";
const bundle = "55555555-5555-5555-5555-555555555555";
const newRunId = "66666666-6666-6666-6666-666666666666";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("create_bg_run — API/workflow target", () => {
  it("sends endpoint_id + execution and omits bundle_artifact_id entirely", async () => {
    let sent: Record<string, unknown> = {};
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/bg-runs`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ run_id: newRunId, status: "queued" });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const r = await createBgRunHandler(client, {
      workspace_id: wsId,
      eval_set_artifact_id: evalSet,
      reference_artifact_id: reference,
      vendor: "http",
      endpoint_id: endpoint,
      execution: "hosted",
    });

    expect(r.isError).toBeUndefined();
    expect(sent.endpoint_id).toBe(endpoint);
    expect(sent.execution).toBe("hosted");
    expect(sent.vendor).toBe("http");
    // Absent, not null and not "": sending a placeholder would make the run
    // look like it referenced a model it never had.
    expect("bundle_artifact_id" in sent).toBe(false);
  });

  it("still sends bundle_artifact_id on the device path", async () => {
    let sent: Record<string, unknown> = {};
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/bg-runs`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ run_id: newRunId, status: "queued" });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    await createBgRunHandler(client, {
      workspace_id: wsId,
      bundle_artifact_id: bundle,
      eval_set_artifact_id: evalSet,
      reference_artifact_id: reference,
    });
    expect(sent.bundle_artifact_id).toBe(bundle);
  });

  it("refuses endpoint_id and http together, as the backend does", () => {
    const parsed = createBgRunInputSchema.safeParse({
      workspace_id: wsId,
      eval_set_artifact_id: evalSet,
      reference_artifact_id: reference,
      endpoint_id: endpoint,
      http: { endpoint_url: "https://x.test/h" },
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a bundle and an endpoint together", () => {
    const parsed = createBgRunInputSchema.safeParse({
      workspace_id: wsId,
      bundle_artifact_id: bundle,
      eval_set_artifact_id: evalSet,
      reference_artifact_id: reference,
      endpoint_id: endpoint,
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a run with nothing to gate", () => {
    const parsed = createBgRunInputSchema.safeParse({
      workspace_id: wsId,
      eval_set_artifact_id: evalSet,
      reference_artifact_id: reference,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("capture_reference — http flavor", () => {
  it("sends endpoint_id so EdgeGate captures the baseline server-side", async () => {
    let sent: Record<string, unknown> = {};
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/reference-captures`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          job_id: "77777777-7777-7777-7777-777777777777",
          flavor: "http",
          status: "queued",
        });
      })
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const r = await captureReferenceHandler(client, {
      workspace_id: wsId,
      eval_set_artifact_id: evalSet,
      system_prompt: "You are a support workflow.",
      endpoint_id: endpoint,
    });

    expect(r.isError).toBeUndefined();
    expect(sent.endpoint_id).toBe(endpoint);
  });

  it("counts the http flavor as ONE branch of the three-way XOR", () => {
    const ok = captureReferenceInputSchema.safeParse({
      workspace_id: wsId,
      eval_set_artifact_id: evalSet,
      system_prompt: "s",
      endpoint_id: endpoint,
    });
    expect(ok.success).toBe(true);

    // http flavor plus a second flavor is still the ambiguity the XOR exists for.
    const two = captureReferenceInputSchema.safeParse({
      workspace_id: wsId,
      eval_set_artifact_id: evalSet,
      system_prompt: "s",
      endpoint_id: endpoint,
      hf_repo: "meta-llama/Llama-3.2-3B",
    });
    expect(two.success).toBe(false);
  });

  it("refuses endpoint_id and http together", () => {
    const parsed = captureReferenceInputSchema.safeParse({
      workspace_id: wsId,
      eval_set_artifact_id: evalSet,
      system_prompt: "s",
      endpoint_id: endpoint,
      http: { endpoint_url: "https://x.test/h" },
    });
    expect(parsed.success).toBe(false);
  });

  it("leaves the two original flavors working", () => {
    const flavors = [
      { hf_repo: "meta-llama/Llama-3.2-3B" },
      { reference_upload_artifact_id: reference },
    ];
    for (const flavor of flavors) {
      const parsed = captureReferenceInputSchema.safeParse({
        workspace_id: wsId,
        eval_set_artifact_id: evalSet,
        system_prompt: "s",
        ...flavor,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
