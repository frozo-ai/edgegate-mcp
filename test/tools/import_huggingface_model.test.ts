import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { importHuggingfaceModelHandler } from "../../src/tools/import_huggingface_model.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const jobId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const artifactId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
  vi.useRealTimers();
});

const basePostResponse = {
  import_job_id: jobId,
  status: "queued",
  hf_repo_id: "microsoft/resnet-50",
  revision: "main",
  artifact_id: null,
  size_bytes: null,
  filename: null,
  error_detail: null,
};

// ─── 1. Happy path with poll ──────────────────────────────────────────────

describe("happy path with poll", () => {
  it("polls until done and returns artifact_id", async () => {
    vi.useFakeTimers();

    let getCallCount = 0;
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface`,
        () => HttpResponse.json(basePostResponse, { status: 202 })
      ),
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface/${jobId}`,
        () => {
          getCallCount += 1;
          if (getCallCount === 1) {
            return HttpResponse.json({ ...basePostResponse, status: "downloading" });
          }
          if (getCallCount === 2) {
            return HttpResponse.json({ ...basePostResponse, status: "uploading_to_hub" });
          }
          return HttpResponse.json({
            ...basePostResponse,
            status: "done",
            artifact_id: artifactId,
            size_bytes: 5_242_880,
            filename: "model.onnx",
          });
        }
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const resultPromise = importHuggingfaceModelHandler(client, {
      workspace_id: wsId,
      hf_repo_id: "microsoft/resnet-50",
      revision: "main",
      poll_for_completion: true,
      max_poll_seconds: 300,
    });

    // Advance past the poll intervals (3 GET calls × 5000ms each)
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(artifactId);
    expect(result.content[0].text).toContain("5.0 MB");
    expect(result.content[0].text).toContain("model.onnx");
    expect(result.content[0].text).toMatch(/edgegate_create_pipeline/i);
    expect(getCallCount).toBe(3);
  });
});

// ─── 2. Happy path no-poll ────────────────────────────────────────────────

describe("happy path no-poll", () => {
  it("returns immediately with import_job_id without calling GET", async () => {
    let getCallCount = 0;
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface`,
        () => HttpResponse.json(basePostResponse, { status: 202 })
      ),
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface/${jobId}`,
        () => {
          getCallCount += 1;
          return HttpResponse.json({ ...basePostResponse, status: "downloading" });
        }
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await importHuggingfaceModelHandler(client, {
      workspace_id: wsId,
      hf_repo_id: "microsoft/resnet-50",
      poll_for_completion: false,
      max_poll_seconds: 300,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(jobId);
    expect(result.content[0].text).toMatch(/poll_for_completion/i);
    expect(getCallCount).toBe(0);
  });
});

// ─── 3. Failed import ─────────────────────────────────────────────────────

describe("failed import", () => {
  it("returns isError=true with the error_detail surfaced", async () => {
    vi.useFakeTimers();

    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface`,
        () => HttpResponse.json(basePostResponse, { status: 202 })
      ),
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface/${jobId}`,
        () =>
          HttpResponse.json({
            ...basePostResponse,
            status: "failed",
            error_detail: "no ONNX file found in repository",
          })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const resultPromise = importHuggingfaceModelHandler(client, {
      workspace_id: wsId,
      hf_repo_id: "microsoft/resnet-50",
      poll_for_completion: true,
      max_poll_seconds: 300,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no ONNX file found in repository");
  });
});

// ─── 4. Invalid hf_repo_id format ─────────────────────────────────────────

describe("invalid hf_repo_id format", () => {
  it("rejects bad repo id client-side with no network call", async () => {
    let postCallCount = 0;
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface`,
        () => {
          postCallCount += 1;
          return HttpResponse.json(basePostResponse, { status: 202 });
        }
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });

    // The zod schema is applied by server.ts, but the handler itself receives
    // pre-validated input. We test schema validation directly here.
    const { importHuggingfaceModelInputSchema } = await import(
      "../../src/tools/import_huggingface_model.js"
    );

    const parsed = importHuggingfaceModelInputSchema.safeParse({
      workspace_id: wsId,
      hf_repo_id: "not-a-repo",
      poll_for_completion: true,
      max_poll_seconds: 300,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toMatch(/owner.*name|format/i);
    }
    expect(postCallCount).toBe(0);
  });
});

// ─── 5. Timeout ───────────────────────────────────────────────────────────

describe("timeout", () => {
  it("returns still-running message after max_poll_seconds elapses", async () => {
    vi.useFakeTimers();

    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface`,
        () => HttpResponse.json(basePostResponse, { status: 202 })
      ),
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface/${jobId}`,
        () =>
          HttpResponse.json({ ...basePostResponse, status: "downloading" })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const resultPromise = importHuggingfaceModelHandler(client, {
      workspace_id: wsId,
      hf_repo_id: "microsoft/resnet-50",
      poll_for_completion: true,
      max_poll_seconds: 2,
    });

    // Advance time well past the 2s deadline
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/still running|check back/i);
    expect(result.content[0].text).toContain(jobId);
  });
});

// ─── 6. 402 from backend ──────────────────────────────────────────────────

describe("402 from backend", () => {
  it("returns isError=true with upgrade CTA", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/artifacts/import-huggingface`,
        () =>
          HttpResponse.json(
            { detail: "HuggingFace imports are not available on your current plan." },
            { status: 402 }
          )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await importHuggingfaceModelHandler(client, {
      workspace_id: wsId,
      hf_repo_id: "microsoft/resnet-50",
      poll_for_completion: true,
      max_poll_seconds: 300,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/upgrade|pricing/i);
    expect(result.content[0].text).toMatch(/edgegate\.frozo\.ai\/pricing/i);
  });
});
