import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import {
  compileGenieHandler,
  compileGenieInputSchema,
} from "../../src/tools/compile_genie.js";
import { checkGenieCompileStatusHandler } from "../../src/tools/check_genie_compile_status.js";
import {
  createBgRunHandler,
  createBgRunInputSchema,
} from "../../src/tools/create_bg_run.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const jobId = "22222222-2222-2222-2222-222222222222";
const bundleArtifactId = "33333333-3333-3333-3333-333333333333";
const onnxA = "44444444-4444-4444-4444-444444444444";
const onnxB = "55555555-5555-5555-5555-555555555555";
const evalArtifactId = "66666666-6666-6666-6666-666666666666";
const refArtifactId = "77777777-7777-7777-7777-777777777777";
const runId = "88888888-8888-8888-8888-888888888888";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const client = () => new EdgeGateClient({ apiUrl, apiKey });

// ─── compile_genie ─────────────────────────────────────────────────────────

describe("compile_genie", () => {
  it("submits a Lane A (hf_repo) compile and returns job markdown", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/genie-compile`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.hf_repo).toBe("meta-llama/Llama-3.2-1B-Instruct");
        expect(body.device_label).toBe("sm8550");
        expect(body.onnx_artifact_ids).toBeUndefined();
        expect(body.bundle_artifact_id).toBeUndefined();
        return HttpResponse.json(
          { job_id: jobId, lane: "A", status: "queued" },
          { status: 202 }
        );
      })
    );
    const result = await compileGenieHandler(client(), {
      workspace_id: wsId,
      device_id: "sm8550",
      hf_repo: "meta-llama/Llama-3.2-1B-Instruct",
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(jobId);
    expect(text).toContain("lane: A");
    expect(text).toContain("queued");
  });

  it("submits a Lane B (onnx_artifact_ids) compile", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/genie-compile`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.onnx_artifact_ids).toEqual([onnxA, onnxB]);
        return HttpResponse.json(
          { job_id: jobId, lane: "B", status: "queued" },
          { status: 202 }
        );
      })
    );
    const result = await compileGenieHandler(client(), {
      workspace_id: wsId,
      device_id: "sm8550",
      onnx_artifact_ids: [onnxA, onnxB],
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("lane: B");
  });

  it("zod rejects zero lane selectors before the network call", () => {
    const parsed = compileGenieInputSchema.safeParse({
      workspace_id: wsId,
      device_id: "sm8550",
    });
    expect(parsed.success).toBe(false);
  });

  it("zod rejects multiple lane selectors before the network call", () => {
    const parsed = compileGenieInputSchema.safeParse({
      workspace_id: wsId,
      device_id: "sm8550",
      hf_repo: "meta-llama/Llama-3.2-1B-Instruct",
      bundle_artifact_id: bundleArtifactId,
    });
    expect(parsed.success).toBe(false);
  });

  it("surfaces a server-side 422 lane error (arbitrary single-ONNX Lane B)", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/genie-compile`, () =>
        HttpResponse.json({ detail: "not genie-ready" }, { status: 422 })
      )
    );
    const result = await compileGenieHandler(client(), {
      workspace_id: wsId,
      device_id: "sm8550",
      onnx_artifact_ids: [onnxA],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/exactly one lane/i);
  });

  it("surfaces 401 auth error", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/genie-compile`, () =>
        HttpResponse.json({ detail: "unauthorized" }, { status: 401 })
      )
    );
    const result = await compileGenieHandler(client(), {
      workspace_id: wsId,
      device_id: "sm8550",
      hf_repo: "meta-llama/Llama-3.2-1B-Instruct",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/EDGEGATE_API_KEY/);
  });
});

// ─── check_genie_compile_status ────────────────────────────────────────────

describe("check_genie_compile_status", () => {
  it("returns bundle_artifact_id when done", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/genie-compile/${jobId}`, () =>
        HttpResponse.json(
          { job_id: jobId, lane: "A", status: "done", bundle_artifact_id: bundleArtifactId },
          { status: 200 }
        )
      )
    );
    const result = await checkGenieCompileStatusHandler(client(), {
      workspace_id: wsId,
      job_id: jobId,
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("status: done");
    expect(text).toContain(bundleArtifactId);
    expect(text).toContain("edgegate_create_bg_run");
  });

  it("reports a still-running job without a bundle", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/genie-compile/${jobId}`, () =>
        HttpResponse.json(
          { job_id: jobId, lane: "A", status: "running", bundle_artifact_id: null },
          { status: 200 }
        )
      )
    );
    const result = await checkGenieCompileStatusHandler(client(), {
      workspace_id: wsId,
      job_id: jobId,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Not done yet/i);
  });

  it("surfaces 404 unknown job", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/genie-compile/${jobId}`, () =>
        HttpResponse.json({ detail: "nope" }, { status: 404 })
      )
    );
    const result = await checkGenieCompileStatusHandler(client(), {
      workspace_id: wsId,
      job_id: jobId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown workspace/i);
  });
});

// ─── create_bg_run ─────────────────────────────────────────────────────────

describe("create_bg_run", () => {
  it("creates a run and returns run markdown", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/bg-runs`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.bundle_artifact_id).toBe(bundleArtifactId);
        expect(body.eval_set_artifact_id).toBe(evalArtifactId);
        expect(body.reference_artifact_id).toBe(refArtifactId);
        expect(body.vendor).toBe("qualcomm");
        return HttpResponse.json({ run_id: runId, status: "created" }, { status: 201 });
      })
    );
    const result = await createBgRunHandler(client(), {
      workspace_id: wsId,
      bundle_artifact_id: bundleArtifactId,
      eval_set_artifact_id: evalArtifactId,
      reference_artifact_id: refArtifactId,
      vendor: "qualcomm",
      system_prompt: "You are a vehicle cockpit assistant.",
      decode_config: { seed: 0 },
      device_label: "Samsung Galaxy S23 Ultra / Snapdragon 8 Gen 2 (SM8550)",
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(runId);
    expect(text).toContain("status: created");
  });

  it("omits optional fields from the body when not provided", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/bg-runs`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.vendor).toBeUndefined();
        expect(body.system_prompt).toBeUndefined();
        expect(body.decode_config).toBeUndefined();
        expect(body.device_label).toBeUndefined();
        return HttpResponse.json({ run_id: runId, status: "created" }, { status: 201 });
      })
    );
    const result = await createBgRunHandler(client(), {
      workspace_id: wsId,
      bundle_artifact_id: bundleArtifactId,
      eval_set_artifact_id: evalArtifactId,
      reference_artifact_id: refArtifactId,
    });
    expect(result.isError).toBeUndefined();
  });

  it("zod rejects a missing reference_artifact_id", () => {
    const parsed = createBgRunInputSchema.safeParse({
      workspace_id: wsId,
      bundle_artifact_id: bundleArtifactId,
      eval_set_artifact_id: evalArtifactId,
    });
    expect(parsed.success).toBe(false);
  });

  it("surfaces a server-side 400 reference/eval-set mismatch", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/bg-runs`, () =>
        HttpResponse.json({ detail: "eval_set_sha256 mismatch" }, { status: 400 })
      )
    );
    const result = await createBgRunHandler(client(), {
      workspace_id: wsId,
      bundle_artifact_id: bundleArtifactId,
      eval_set_artifact_id: evalArtifactId,
      reference_artifact_id: refArtifactId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/mismatch/i);
  });

  it("surfaces 403 auth error", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/bg-runs`, () =>
        HttpResponse.json({ detail: "forbidden" }, { status: 403 })
      )
    );
    const result = await createBgRunHandler(client(), {
      workspace_id: wsId,
      bundle_artifact_id: bundleArtifactId,
      eval_set_artifact_id: evalArtifactId,
      reference_artifact_id: refArtifactId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/admin access/i);
  });
});
