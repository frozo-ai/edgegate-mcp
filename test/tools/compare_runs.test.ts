import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { compareRunsHandler } from "../../src/tools/compare_runs.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const pipelineId = "aaaa0000-0000-0000-0000-000000000001";
const runIdA = "bbbb0000-0000-0000-0000-000000000001"; // baseline
const runIdB = "bbbb0000-0000-0000-0000-000000000002"; // candidate

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

// ─── Shared fixtures ───────────────────────────────────────────────────────

function makeRun(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    pipeline_id: pipelineId,
    pipeline_name: "edge-regression",
    status: "passed",
    trigger: "manual",
    model_artifact_id: "art-1",
    model_filename: "model.onnx",
    error_code: null,
    error_detail: null,
    created_at: "2026-06-04T10:00:00Z",
    updated_at: "2026-06-04T10:10:00Z",
    completed_at: "2026-06-04T10:10:00Z",
    hub_model_id: "hub-1",
    hub_job_id: "job-1",
    normalized_metrics: { inference_time_ms: 8.4, peak_memory_mb: 120 },
    gates_eval: {
      passed: true,
      gates: [
        {
          metric: "inference_time_ms",
          passed: true,
          operator: "lte",
          threshold: 10,
          description: null,
          actual_value: 8.4,
        },
      ],
    },
    bundle_artifact_id: "bundle-1",
    ...overrides,
  };
}

// ─── Scenario: backend /diff endpoint available (Scenario A fast path) ─────

describe("compare_runs — backend /diff available", () => {
  it("renders NEUTRAL when metrics are similar and no gate flips", async () => {
    const candidateRun = makeRun(runIdB);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () =>
        HttpResponse.json({
          current_run_id: runIdB,
          previous_run_id: runIdA,
          diff_sha256: "abc123",
          diff: {
            current_run_id: runIdB,
            previous_run_id: runIdA,
            current_commit: {},
            previous_commit: {},
            current_completed_at: "2026-06-04T10:10:00Z",
            previous_completed_at: "2026-06-03T10:10:00Z",
            metric_deltas: {
              inference_time_ms: {
                current: 8.4,
                previous: 8.2,
                delta: 0.2,
                delta_pct: 2.44,
              },
              peak_memory_mb: {
                current: 120,
                previous: 118,
                delta: 2,
                delta_pct: 1.69,
              },
            },
            gate_flips: [
              {
                metric: "inference_time_ms",
                transition: "unchanged",
                previous: { passed: true, threshold: 10, operator: "lte", actual_value: 8.2 },
                current:  { passed: true, threshold: 10, operator: "lte", actual_value: 8.4 },
              },
            ],
            per_device: null,
            per_cell: null,
            is_baseline: false,
          },
          created_at: "2026-06-04T10:10:30Z",
        })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, { workspace_id: wsId, run_id: runIdB });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("NEUTRAL");
    expect(text).toContain("inference_time_ms");
    expect(text).toContain("+2.4%");
    expect(text).toContain("abc123"); // diff_sha256 in audit trail
  });

  it("renders REGRESSION when a gate flips ✓→✗", async () => {
    const candidateRun = makeRun(runIdB, {
      normalized_metrics: { inference_time_ms: 15.1, peak_memory_mb: 120 },
      gates_eval: {
        passed: false,
        gates: [
          {
            metric: "inference_time_ms",
            passed: false,
            operator: "lte",
            threshold: 10,
            description: null,
            actual_value: 15.1,
          },
        ],
      },
    });

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () =>
        HttpResponse.json({
          current_run_id: runIdB,
          previous_run_id: runIdA,
          diff_sha256: "def456",
          diff: {
            current_run_id: runIdB,
            previous_run_id: runIdA,
            current_commit: {},
            previous_commit: {},
            current_completed_at: "2026-06-04T10:10:00Z",
            previous_completed_at: "2026-06-03T10:10:00Z",
            metric_deltas: {
              inference_time_ms: {
                current: 15.1,
                previous: 8.4,
                delta: 6.7,
                delta_pct: 79.76,
              },
            },
            gate_flips: [
              {
                metric: "inference_time_ms",
                transition: "regressed",
                previous: { passed: true, threshold: 10, operator: "lte", actual_value: 8.4 },
                current:  { passed: false, threshold: 10, operator: "lte", actual_value: 15.1 },
              },
            ],
            per_device: null,
            per_cell: null,
            is_baseline: false,
          },
          created_at: "2026-06-04T10:10:30Z",
        })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, { workspace_id: wsId, run_id: runIdB });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("REGRESSION");
    // Gate table contains the flip label (bold markdown: **REGRESSION** ✓→✗)
    expect(text).toContain("✓→✗");
  });

  it("renders IMPROVEMENT when a gate flips ✗→✓", async () => {
    const candidateRun = makeRun(runIdB);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () =>
        HttpResponse.json({
          current_run_id: runIdB,
          previous_run_id: runIdA,
          diff_sha256: "ghi789",
          diff: {
            current_run_id: runIdB,
            previous_run_id: runIdA,
            current_commit: {},
            previous_commit: {},
            current_completed_at: "2026-06-04T10:10:00Z",
            previous_completed_at: "2026-06-03T10:10:00Z",
            metric_deltas: {
              inference_time_ms: {
                current: 8.4,
                previous: 14.5,
                delta: -6.1,
                delta_pct: -42.07,
              },
            },
            gate_flips: [
              {
                metric: "inference_time_ms",
                transition: "improved",
                previous: { passed: false, threshold: 10, operator: "lte", actual_value: 14.5 },
                current:  { passed: true,  threshold: 10, operator: "lte", actual_value: 8.4 },
              },
            ],
            per_device: null,
            per_cell: null,
            is_baseline: false,
          },
          created_at: "2026-06-04T10:10:30Z",
        })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, { workspace_id: wsId, run_id: runIdB });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("IMPROVEMENT");
    expect(text).toContain("RECOVERY ✗→✓");
  });

  it("renders is_baseline=true as NO BASELINE", async () => {
    const candidateRun = makeRun(runIdB);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () =>
        HttpResponse.json({
          current_run_id: runIdB,
          previous_run_id: null,
          diff_sha256: null,
          diff: {
            current_run_id: runIdB,
            previous_run_id: null,
            current_commit: {},
            previous_commit: null,
            current_completed_at: "2026-06-04T10:10:00Z",
            previous_completed_at: null,
            metric_deltas: {},
            gate_flips: [],
            per_device: null,
            per_cell: null,
            is_baseline: true,
          },
          created_at: "2026-06-04T10:10:30Z",
        })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, { workspace_id: wsId, run_id: runIdB });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("NO BASELINE");
  });
});

// ─── Scenario: auto-baseline selection (404 from /diff, list runs) ─────────

describe("compare_runs — auto-baseline selection", () => {
  it("picks the most recent PASSED run as baseline when /diff returns 404", async () => {
    const candidateRun = makeRun(runIdB);
    const baselineRun = makeRun(runIdA, { status: "passed" });

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () =>
        HttpResponse.json({ detail: "Run has no diff yet" }, { status: 404 })
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("pipeline_id") === pipelineId) {
          return HttpResponse.json([candidateRun, baselineRun]);
        }
        return HttpResponse.json([]);
      }),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdA}`, () =>
        HttpResponse.json(baselineRun)
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, { workspace_id: wsId, run_id: runIdB });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // Should show comparison with baseline runIdA
    expect(text).toContain(runIdA);
    expect(text).toContain("client-side"); // client-side diff note in audit trail
  });

  it("returns NO BASELINE when no prior runs exist in the pipeline", async () => {
    const candidateRun = makeRun(runIdB);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () =>
        HttpResponse.json({ detail: "Run has no diff yet" }, { status: 404 })
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs`, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("pipeline_id") === pipelineId) {
          // Only the candidate itself — nothing to compare
          return HttpResponse.json([candidateRun]);
        }
        return HttpResponse.json([]);
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, { workspace_id: wsId, run_id: runIdB });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("NO BASELINE");
    expect(text).toContain("edge-regression"); // pipeline name in message
  });

  it("falls back to explicit baseline_run_id without calling /diff", async () => {
    const candidateRun = makeRun(runIdB);
    const baselineRun = makeRun(runIdA);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      // /diff should NOT be called when explicit baseline is provided
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdA}`, () =>
        HttpResponse.json(baselineRun)
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, {
      workspace_id: wsId,
      run_id: runIdB,
      baseline_run_id: runIdA,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(runIdA);
    expect(text).toContain(runIdB);
    // Should be NEUTRAL — same metrics
    expect(text).toContain("NEUTRAL");
  });
});

// ─── Scenario: per-device breakdown ────────────────────────────────────────

describe("compare_runs — per-device breakdown", () => {
  it("renders per-device section when backend provides it", async () => {
    const candidateRun = makeRun(runIdB);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
        HttpResponse.json(candidateRun)
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () =>
        HttpResponse.json({
          current_run_id: runIdB,
          previous_run_id: runIdA,
          diff_sha256: "per-device-sha",
          diff: {
            current_run_id: runIdB,
            previous_run_id: runIdA,
            current_commit: {},
            previous_commit: {},
            current_completed_at: "2026-06-04T10:10:00Z",
            previous_completed_at: "2026-06-03T10:10:00Z",
            metric_deltas: {
              inference_time_ms: { current: 9.0, previous: 8.4, delta: 0.6, delta_pct: 7.14 },
            },
            gate_flips: [
              {
                metric: "inference_time_ms",
                transition: "unchanged",
                previous: { passed: true, threshold: 10, operator: "lte", actual_value: 8.4 },
                current:  { passed: true, threshold: 10, operator: "lte", actual_value: 9.0 },
              },
            ],
            per_device: {
              "Samsung Galaxy S24": {
                inference_time_ms: { current: 9.0, previous: 8.4, delta: 0.6, delta_pct: 7.14 },
              },
              "Snapdragon X Elite": {
                inference_time_ms: { current: 7.5, previous: 8.0, delta: -0.5, delta_pct: -6.25 },
              },
            },
            per_cell: null,
            is_baseline: false,
          },
          created_at: "2026-06-04T10:10:30Z",
        })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await compareRunsHandler(client, { workspace_id: wsId, run_id: runIdB });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Per-Device Breakdown");
    expect(text).toContain("Samsung Galaxy S24");
    expect(text).toContain("Snapdragon X Elite");
  });
});
