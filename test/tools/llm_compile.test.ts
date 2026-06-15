import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import {
  llmCompileHandler,
  llmCompileInputSchema,
} from "../../src/tools/llm_compile.js";
import {
  checkLLMCompileStatusHandler,
  checkLLMCompileStatusInputSchema,
} from "../../src/tools/check_llm_compile_status.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const compileJobId = "22222222-2222-2222-2222-222222222222";
const compositeId = "33333333-3333-3333-3333-333333333333";
const srcA = "44444444-4444-4444-4444-444444444444";
const srcB = "55555555-5555-5555-5555-555555555555";
const srcC = "66666666-6666-6666-6666-666666666666";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

// ─── Input schema validation ────────────────────────────────────────────────

describe("llm_compile input schema", () => {
  it("accepts a minimal 1-component compile", () => {
    const parsed = llmCompileInputSchema.safeParse({
      workspace_id: wsId,
      source_artifact_ids: [srcA],
      device_id: "x_elite",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // defaults applied
      expect(parsed.data.target_runtime).toBe("genie");
      expect(parsed.data.sequence_lengths).toEqual([128, 1]);
      expect(parsed.data.context_lengths).toEqual([4096]);
    }
  });

  it("accepts a 3-component compile with explicit roles", () => {
    const parsed = llmCompileInputSchema.safeParse({
      workspace_id: wsId,
      source_artifact_ids: [srcA, srcB, srcC],
      device_id: "x_elite",
      roles: ["prompt", "token", "kv_cache"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty source_artifact_ids", () => {
    const parsed = llmCompileInputSchema.safeParse({
      workspace_id: wsId,
      source_artifact_ids: [],
      device_id: "x_elite",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 8 components (cap)", () => {
    const ids = Array.from({ length: 9 }, (_, i) =>
      `${i.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`
    );
    const parsed = llmCompileInputSchema.safeParse({
      workspace_id: wsId,
      source_artifact_ids: ids,
      device_id: "x_elite",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-UUID source ids", () => {
    const parsed = llmCompileInputSchema.safeParse({
      workspace_id: wsId,
      source_artifact_ids: ["not-a-uuid"],
      device_id: "x_elite",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("check_llm_compile_status input schema", () => {
  it("requires UUIDs", () => {
    const ok = checkLLMCompileStatusInputSchema.safeParse({
      workspace_id: wsId,
      compile_job_id: compileJobId,
    });
    expect(ok.success).toBe(true);
    const bad = checkLLMCompileStatusInputSchema.safeParse({
      workspace_id: wsId,
      compile_job_id: "not-a-uuid",
    });
    expect(bad.success).toBe(false);
  });
});

// ─── Handler client-side guards ─────────────────────────────────────────────

describe("llm_compile multi-component guards", () => {
  it("returns isError when multi-component compile is missing roles", async () => {
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await llmCompileHandler(client, {
      workspace_id: wsId,
      source_artifact_ids: [srcA, srcB, srcC],
      device_id: "x_elite",
      target_runtime: "genie",
      sequence_lengths: [128, 1],
      context_lengths: [4096],
      roles: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/roles.*required/i);
  });

  it("returns isError when roles length mismatches source ids", async () => {
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await llmCompileHandler(client, {
      workspace_id: wsId,
      source_artifact_ids: [srcA, srcB, srcC],
      device_id: "x_elite",
      target_runtime: "genie",
      sequence_lengths: [128, 1],
      context_lengths: [4096],
      roles: ["prompt", "token"], // 2 vs 3 — bug
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/length.*match/i);
  });
});

// ─── Happy path POST ────────────────────────────────────────────────────────

describe("llm_compile happy path", () => {
  it("POSTs to /v1/workspaces/{ws}/llm-compile and surfaces the compile_job_id", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/llm-compile`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            compile_job_id: compileJobId,
            status: "queued",
            composite_artifact_id: null,
            error_detail: null,
            progress: { compile_jobs_done: 0, compile_jobs_total: 3 },
            device_id: "x_elite",
            target_runtime: "genie",
          },
          { status: 202 }
        );
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await llmCompileHandler(client, {
      workspace_id: wsId,
      source_artifact_ids: [srcA, srcB, srcC],
      device_id: "x_elite",
      target_runtime: "genie",
      sequence_lengths: [128, 1],
      context_lengths: [4096],
      roles: ["prompt", "token", "kv_cache"],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(compileJobId);
    expect(result.content[0].text).toMatch(/edgegate_check_llm_compile_status/);
    expect(receivedBody).toMatchObject({
      source_artifact_ids: [srcA, srcB, srcC],
      device_id: "x_elite",
      target_runtime: "genie",
      sequence_lengths: [128, 1],
      context_lengths: [4096],
      roles: ["prompt", "token", "kv_cache"],
    });
  });

  it("surfaces the 402 monthly-cap message", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/llm-compile`, () =>
        HttpResponse.json(
          { detail: "Workspace LLM compile cap reached (100/mo on Pro)." },
          { status: 402 }
        )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await llmCompileHandler(client, {
      workspace_id: wsId,
      source_artifact_ids: [srcA],
      device_id: "x_elite",
      target_runtime: "genie",
      sequence_lengths: [128, 1],
      context_lengths: [4096],
      roles: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/monthly LLM compile cap|pricing/i);
  });
});

// ─── Check status ───────────────────────────────────────────────────────────

describe("check_llm_compile_status happy path", () => {
  it("formats a completed job and surfaces composite_artifact_id", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/llm-compile/${compileJobId}`,
        () =>
          HttpResponse.json({
            compile_job_id: compileJobId,
            status: "completed",
            composite_artifact_id: compositeId,
            error_detail: null,
            progress: { compile_jobs_done: 3, compile_jobs_total: 3 },
            device_id: "x_elite",
            target_runtime: "genie",
          })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkLLMCompileStatusHandler(client, {
      workspace_id: wsId,
      compile_job_id: compileJobId,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/COMPLETED/);
    expect(result.content[0].text).toContain(compositeId);
    expect(result.content[0].text).toMatch(/3\/3/);
  });

  it("surfaces error_detail for a failed job", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/llm-compile/${compileJobId}`,
        () =>
          HttpResponse.json({
            compile_job_id: compileJobId,
            status: "failed",
            composite_artifact_id: null,
            error_detail: "ai-hub returned 503 for component prompt",
            progress: { compile_jobs_done: 1, compile_jobs_total: 3 },
          })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkLLMCompileStatusHandler(client, {
      workspace_id: wsId,
      compile_job_id: compileJobId,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/FAILED/);
    expect(result.content[0].text).toContain("ai-hub returned 503");
  });

  it("returns isError on 404", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/llm-compile/${compileJobId}`,
        () => HttpResponse.json({ detail: "not found" }, { status: 404 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkLLMCompileStatusHandler(client, {
      workspace_id: wsId,
      compile_job_id: compileJobId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No LLM compile job/);
  });
});
