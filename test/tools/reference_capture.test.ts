import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import {
  captureReferenceHandler,
  captureReferenceInputSchema,
} from "../../src/tools/capture_reference.js";
import { checkReferenceCaptureStatusHandler } from "../../src/tools/check_reference_capture_status.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const evalArtifactId = "22222222-2222-2222-2222-222222222222";
const jobId = "33333333-3333-3333-3333-333333333333";
const refArtifactId = "44444444-4444-4444-4444-444444444444";
const uploadArtifactId = "55555555-5555-5555-5555-555555555555";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const client = () => new EdgeGateClient({ apiUrl, apiKey });

// ─── capture_reference ─────────────────────────────────────────────────────

describe("capture_reference", () => {
  it("queues an auto-FP16 capture and returns job markdown", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/reference-captures`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.hf_repo).toBe("meta-llama/Llama-3.2-1B-Instruct");
        expect(body.eval_set_artifact_id).toBe(evalArtifactId);
        expect(body.reference_upload_artifact_id).toBeUndefined();
        return HttpResponse.json(
          { job_id: jobId, flavor: "auto_fp16", status: "queued" },
          { status: 202 }
        );
      })
    );
    const result = await captureReferenceHandler(client(), {
      workspace_id: wsId,
      eval_set_artifact_id: evalArtifactId,
      system_prompt: "You are a vehicle cockpit assistant.",
      decode_config: { seed: 0 },
      hf_repo: "meta-llama/Llama-3.2-1B-Instruct",
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(jobId);
    expect(text).toContain("auto_fp16");
    expect(text).toContain("queued");
  });

  it("queues a golden capture via reference_upload_artifact_id", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/reference-captures`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.reference_upload_artifact_id).toBe(uploadArtifactId);
        return HttpResponse.json(
          { job_id: jobId, flavor: "golden", status: "queued" },
          { status: 202 }
        );
      })
    );
    const result = await captureReferenceHandler(client(), {
      workspace_id: wsId,
      eval_set_artifact_id: evalArtifactId,
      system_prompt: "Cockpit assistant.",
      reference_upload_artifact_id: uploadArtifactId,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("golden");
  });

  it("zod rejects zero flavor selectors before the network call", () => {
    const parsed = captureReferenceInputSchema.safeParse({
      workspace_id: wsId,
      eval_set_artifact_id: evalArtifactId,
      system_prompt: "x",
    });
    expect(parsed.success).toBe(false);
  });

  it("zod rejects both flavor selectors before the network call", () => {
    const parsed = captureReferenceInputSchema.safeParse({
      workspace_id: wsId,
      eval_set_artifact_id: evalArtifactId,
      system_prompt: "x",
      hf_repo: "meta-llama/Llama-3.2-1B-Instruct",
      reference_upload_artifact_id: uploadArtifactId,
    });
    expect(parsed.success).toBe(false);
  });

  it("surfaces a server-side 422 flavor error", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/reference-captures`, () =>
        HttpResponse.json({ detail: "bad flavor" }, { status: 422 })
      )
    );
    const result = await captureReferenceHandler(client(), {
      workspace_id: wsId,
      eval_set_artifact_id: evalArtifactId,
      system_prompt: "x",
      hf_repo: "meta-llama/Llama-3.2-1B-Instruct",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/exactly one flavor/i);
  });

  it("surfaces 401 auth error", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/reference-captures`, () =>
        HttpResponse.json({ detail: "unauthorized" }, { status: 401 })
      )
    );
    const result = await captureReferenceHandler(client(), {
      workspace_id: wsId,
      eval_set_artifact_id: evalArtifactId,
      system_prompt: "x",
      hf_repo: "meta-llama/Llama-3.2-1B-Instruct",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/EDGEGATE_API_KEY/);
  });
});

// ─── check_reference_capture_status ────────────────────────────────────────

describe("check_reference_capture_status", () => {
  it("returns reference_artifact_id when done", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/reference-captures/${jobId}`, () =>
        HttpResponse.json(
          { job_id: jobId, status: "done", reference_artifact_id: refArtifactId },
          { status: 200 }
        )
      )
    );
    const result = await checkReferenceCaptureStatusHandler(client(), {
      workspace_id: wsId,
      job_id: jobId,
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("status: done");
    expect(text).toContain(refArtifactId);
    expect(text).toContain("edgegate_create_bg_run");
  });

  it("reports a still-running job without an artifact", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/reference-captures/${jobId}`, () =>
        HttpResponse.json(
          { job_id: jobId, status: "running", reference_artifact_id: null },
          { status: 200 }
        )
      )
    );
    const result = await checkReferenceCaptureStatusHandler(client(), {
      workspace_id: wsId,
      job_id: jobId,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Not done yet/i);
  });

  it("surfaces 404 unknown job", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/reference-captures/${jobId}`, () =>
        HttpResponse.json({ detail: "nope" }, { status: 404 })
      )
    );
    const result = await checkReferenceCaptureStatusHandler(client(), {
      workspace_id: wsId,
      job_id: jobId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown workspace/i);
  });
});
