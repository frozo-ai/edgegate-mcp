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
beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
  server.use(http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdA}`, () => HttpResponse.json(makeRun(runIdA))));
});
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

// BG RunDetail uses signed bg_verdict.summary, not gates_eval.gates. Shape
// mirrors edgegate/api/routes/runs.py and edgegate/bg/bundle.py.
const evalSetSha = "8e6401fb78b8a979623c5696df602bd9769645ee156f625ee78992c163109cbc";
const passingSignals = [
  { name: "forbidden_action_rate", hard: true, passed: true,
    candidate_value: 0, reference_value: 0, threshold: 0, detail: "No forbidden actions" },
  { name: "safety_probe_pass_rate", hard: true, passed: true,
    candidate_value: 1, reference_value: 1, threshold: 0.95, detail: "All probes passed" },
  { name: "task_success_rate", hard: false, passed: true,
    candidate_value: 1, reference_value: 1, threshold: 0.9, detail: "Tasks completed" },
];
const failingSignals = passingSignals.map((signal) => signal.name === "safety_probe_pass_rate"
  ? { ...signal, passed: false, candidate_value: 0.5, detail: "One probe failed" } : signal);

function makeBgRun(
  id: string,
  summaryOverrides: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const summary = {
    version: 1, passed: true, backend: "api", eval_set_sha256: evalSetSha,
    signals: passingSignals, ...summaryOverrides,
  };
  return makeRun(id, {
    pipeline_id: null, pipeline_name: null, is_bg_run: true,
    normalized_metrics: null, gates_eval: null, bundle_artifact_id: null,
    status: summary.passed === false ? "failed" : "passed",
    bg_verdict: { version: 1, summary, signature: "test-signature", key_id: "test-key" },
    ...overrides,
  });
}

async function compareFixtures(
  candidate: Record<string, unknown>, baseline: Record<string, unknown>
): Promise<string> {
  server.use(
    http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () => HttpResponse.json(candidate)),
    http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdA}`, () => HttpResponse.json(baseline))
  );
  const result = await compareRunsHandler(new EdgeGateClient({ apiUrl, apiKey }), {
    workspace_id: wsId, run_id: runIdB, baseline_run_id: runIdA,
  });
  expect(result.isError).toBeUndefined();
  return result.content[0].text;
}

describe("compare_runs — Behavioral-Gate evidence", () => {
  it("reports a 3/3 PASS to 2/3 FAIL as a safety-signal REGRESSION", async () => {
    const text = await compareFixtures(
      makeBgRun(runIdB, { passed: false, signals: failingSignals }), makeBgRun(runIdA)
    );
    expect(text).toContain("**Overall gate:** PASS → FAIL");
    expect(text).toContain("| safety_probe_pass_rate | hard | ✓ | ✗ | **REGRESSION** ✓→✗ |");
    expect(text).toContain("| safety_probe_pass_rate | 1.00 | 0.50 | -0.50 | 0.95 |");
    expect(text).toContain("**REGRESSION** — one or more hard behavioral signals regressed.");
    expect(text).not.toContain("NEUTRAL");
    expect(text).toContain(evalSetSha);
    expect(text).toContain("unsigned; no diff SHA-256");
    expect(text).not.toContain("signed, embedded");
    expect(text).toContain("do not establish identical reference artifacts");
  });

  it("reports recovery from a failed hard signal", async () => {
    const text = await compareFixtures(makeBgRun(runIdB),
      makeBgRun(runIdA, { passed: false, signals: failingSignals }));
    expect(text).toContain("**Overall gate:** FAIL → PASS");
    expect(text).toContain("**IMPROVEMENT**");
    expect(text).toContain("RECOVERY ✗→✓");
  });

  it("matches signals by name rather than array position", async () => {
    const text = await compareFixtures(
      makeBgRun(runIdB, { signals: [...passingSignals].reverse() }), makeBgRun(runIdA));
    expect(text).toContain("**NEUTRAL**");
    expect(text).not.toContain("REGRESSION");
  });

  it("keeps soft failures advisory instead of claiming a hard-gate regression", async () => {
    const signals = passingSignals.map((signal) => signal.hard ? signal : {
      ...signal, passed: false, candidate_value: 0.5,
    });
    const text = await compareFixtures(makeBgRun(runIdB, { signals }), makeBgRun(runIdA));
    expect(text).toContain("**Overall gate:** PASS → PASS");
    expect(text).toContain("**NEUTRAL**");
    expect(text).toContain("advisory warning (does not fail gate)");
    expect(text).not.toContain("REGRESSION");
  });

  it("reads the authoritative summary rather than unsigned top-level duplicates", async () => {
    const candidate = makeBgRun(runIdB, { passed: false, signals: failingSignals });
    candidate.bg_verdict = { ...(candidate.bg_verdict as object), passed: true, backend: "hardware" };
    const text = await compareFixtures(candidate, makeBgRun(runIdA));
    expect(text).toContain("**REGRESSION**");
    expect(text).toContain("**Execution backend:** api");
  });

  it("does not query /diff or auto-match unrelated null-pipeline runs", async () => {
    server.use(http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () =>
      HttpResponse.json(makeBgRun(runIdB))));
    // Any /diff or /runs request is unhandled and fails this test.
    const result = await compareRunsHandler(new EdgeGateClient({ apiUrl, apiKey }), {
      workspace_id: wsId, run_id: runIdB,
    });
    expect(result.content[0].text).toContain("NO BASELINE");
    expect(result.content[0].text).toContain("Supply baseline_run_id explicitly");
  });

  it.each([
    ["different eval set", { eval_set_sha256: "a".repeat(64) }],
    ["different backend", { backend: "hardware" }],
    ["removed signal", { signals: passingSignals.slice(1) }],
    ["different threshold", { signals: passingSignals.map((s) => ({ ...s, threshold: s.threshold + 1 })) }],
    ["different criticality", { signals: passingSignals.map((s) => ({ ...s, hard: !s.hard })) }],
    ["different reference", { signals: passingSignals.map((s) => ({ ...s, reference_value: s.reference_value + 1 })) }],
  ])("reports NOT COMPARABLE for %s", async (_name, overrides) => {
    const text = await compareFixtures(makeBgRun(runIdB, overrides), makeBgRun(runIdA));
    expect(text).toContain("**NOT COMPARABLE**");
    expect(text).not.toContain("NEUTRAL");
    expect(text).not.toContain("**REGRESSION**");
  });

  it.each([
    ["empty signals", { signals: [] }],
    ["missing signal outcome", { signals: passingSignals.map((s) => ({ ...s, passed: null })) }],
    ["string signal outcome", { signals: passingSignals.map((s) => ({ ...s, passed: "false" })) }],
    ["unknown criticality", { signals: passingSignals.map((s) => ({ ...s, hard: null })) }],
    ["duplicate signal names", { signals: [passingSignals[0], passingSignals[0]] }],
    ["missing eval hash", { eval_set_sha256: null }],
    ["unsupported version", { version: 2 }],
    ["unsupported backend", { backend: "unknown" }],
    ["unknown summary outcome", { passed: null }],
    ["inconsistent summary outcome", { passed: false }],
    ["missing numeric evidence", { signals: passingSignals.map((s) => ({ ...s, candidate_value: null })) }],
  ])("does not infer a neutral result from %s", async (_name, overrides) => {
    const text = await compareFixtures(makeBgRun(runIdB, overrides), makeBgRun(runIdA));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).not.toContain("NEUTRAL");
    expect(text).not.toContain("**REGRESSION**");
  });

  it("does not use standard metrics when the BG verdict is missing", async () => {
    const text = await compareFixtures(makeBgRun(runIdB, {}, {
      bg_verdict: null, normalized_metrics: { inference_time_ms: 8.4 },
    }), makeBgRun(runIdA));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
  });

  it("rejects a mixed BG/standard comparison", async () => {
    const text = await compareFixtures(makeBgRun(runIdB), makeRun(runIdA));
    expect(text).toContain("**NOT COMPARABLE**");
  });

  it.each(["queued", "running", "error", "cancelled", "unsupported"])(
    "does not compare candidate lifecycle state %s as a gate result", async (status) => {
      const text = await compareFixtures(makeBgRun(runIdB, {}, { status }), makeBgRun(runIdA));
      expect(text).toContain("**INSUFFICIENT EVIDENCE**");
      expect(text).toContain(`status ${status}`);
    }
  );

  it("rejects a baseline that has no completed gate outcome", async () => {
    const text = await compareFixtures(makeBgRun(runIdB), makeBgRun(runIdA, {}, { status: "error" }));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).toContain("Baseline run has status error");
  });
});

describe("compare_runs — standard evidence gaps", () => {
  it("does not label two evidence-free standard runs NEUTRAL", async () => {
    const text = await compareFixtures(
      makeRun(runIdB, { normalized_metrics: null, gates_eval: {} }),
      makeRun(runIdA, { normalized_metrics: null, gates_eval: {} }));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).not.toContain("NEUTRAL");
  });

  it.each([{}, { threshold: null, operator: null }, { threshold: 10, operator: "unsupported" }])(
    "does not treat absent or unsupported policies as comparable: %j", async (policy) => {
      const gates_eval = { gates: [{ metric: "inference_time_ms", passed: true, ...policy }] };
      const text = await compareFixtures(makeRun(runIdB, { normalized_metrics: null, gates_eval }),
        makeRun(runIdA, { normalized_metrics: null, gates_eval }));
      expect(text).toContain("**INSUFFICIENT EVIDENCE**");
      expect(text).not.toContain("**NEUTRAL**");
    });

  it("rejects duplicate metrics instead of hiding a failed gate", async () => {
    const gates = [{ metric: "inference_time_ms", passed: true, operator: "lte", threshold: 10 },
      { metric: "inference_time_ms", passed: true, operator: "gte", threshold: 1 }];
    const text = await compareFixtures(makeRun(runIdB, { gates_eval: { gates: [{ ...gates[0], passed: false }, gates[1]] } }),
      makeRun(runIdA, { gates_eval: { gates } }));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).not.toContain("**NEUTRAL**");
  });

  it("rejects duplicate metrics in the explicit baseline", async () => {
    const gates = [{ metric: "inference_time_ms", passed: true, operator: "lte", threshold: 10 },
      { metric: "inference_time_ms", passed: true, operator: "gte", threshold: 1 }];
    const text = await compareFixtures(makeRun(runIdB), makeRun(runIdA, { gates_eval: { gates } }));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).toContain("duplicate metric gates");
  });

  it("rejects duplicate candidate metrics before requesting a stored diff", async () => {
    let requestedDiff = false;
    const gate = { metric: "inference_time_ms", passed: true, operator: "lte", threshold: 10 };
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () => HttpResponse.json(
        makeRun(runIdB, { gates_eval: { gates: [gate, { ...gate, threshold: 20 }] } }))),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () => {
        requestedDiff = true;
        return new HttpResponse(null, { status: 500 });
      })
    );
    const result = await compareRunsHandler(new EdgeGateClient({ apiUrl, apiKey }), {
      workspace_id: wsId, run_id: runIdB,
    });
    expect(result.content[0].text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(requestedDiff).toBe(false);
  });

  it("does not coerce an unknown gate outcome to FAIL", async () => {
    const text = await compareFixtures(makeRun(runIdB, { normalized_metrics: null,
      gates_eval: { gates: [{ metric: "inference_time_ms", threshold: 10, operator: "lte", passed: null }] },
    }), makeRun(runIdA, { normalized_metrics: null }));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).toContain("unknown (missing pass/fail evidence)");
    expect(text).not.toContain("REGRESSION");
  });

  it("rejects explicit standard baselines from a different pipeline", async () => {
    const text = await compareFixtures(makeRun(runIdB), makeRun(runIdA, { pipeline_id: "other-pipeline" }));
    expect(text).toContain("**NOT COMPARABLE**");
  });

  it("does not call a changed gate threshold a measurement regression", async () => {
    const text = await compareFixtures(makeRun(runIdB, { normalized_metrics: null,
      gates_eval: { gates: [{ metric: "inference_time_ms", passed: false,
        operator: "lte", threshold: 5, actual_value: 8.4 }] },
    }), makeRun(runIdA, { normalized_metrics: null }));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).toContain("gate policy changed");
    expect(text).not.toContain("REGRESSION");
  });
});

describe("compare_runs — malformed standard gate evidence", () => {
  it.each([{ gates: [null] }, { gates: [{}] }, { gates: "not-an-array" }])(
    "rejects unsupported gates $gates without inventing a result", async ({ gates }) => {
    const text = await compareFixtures(makeRun(runIdB, { gates_eval: { gates } }), makeRun(runIdA));
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).not.toContain("NEUTRAL");
  });
});

it("prioritizes a hard-signal regression over a simultaneous recovery", async () => {
  const candidateSignals = passingSignals.map((signal) => signal.name === "forbidden_action_rate"
    ? { ...signal, passed: false, candidate_value: 1 } : signal);
  const text = await compareFixtures(
    makeBgRun(runIdB, { passed: false, signals: candidateSignals }),
    makeBgRun(runIdA, { passed: false, signals: failingSignals }));
  expect(text).toContain("**REGRESSION** — one or more hard behavioral signals regressed.");
  expect(text).toContain("RECOVERY ✗→✓");
  expect(text).not.toContain("**IMPROVEMENT**");
});

describe("compare_runs — legacy server diff semantics", () => {
  async function compareServerGate(previous: Record<string, unknown>, current: Record<string, unknown>, transition: string, baseline = makeRun(runIdA)) {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdA}`, () => HttpResponse.json(baseline)),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}`, () => HttpResponse.json(makeRun(runIdB))),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runIdB}/diff`, () => HttpResponse.json({
        current_run_id: runIdB, previous_run_id: runIdA, diff_sha256: "original-diff-sha",
        created_at: "2026-06-04T10:10:30Z",
        diff: {
          current_run_id: runIdB, previous_run_id: runIdA,
          current_commit: {}, previous_commit: {},
          current_completed_at: "2026-06-04T10:10:00Z", previous_completed_at: "2026-06-03T10:10:00Z",
          metric_deltas: {}, gate_flips: [{ metric: "inference_time_ms", transition, previous, current }],
          per_device: null, per_cell: null, is_baseline: false,
        },
      }))
    );
    const result = await compareRunsHandler(new EdgeGateClient({ apiUrl, apiKey }), {
      workspace_id: wsId, run_id: runIdB,
    });
    return result.content[0].text;
  }
  const passedGate = { passed: true, operator: "lte", threshold: 10, actual_value: 8.4 };

  it("rejects a stored diff whose baseline duplicates were already collapsed", async () => {
    const gate = { metric: "inference_time_ms", ...passedGate };
    const baseline = makeRun(runIdA, { gates_eval: { gates: [gate, { ...gate, operator: "gte", threshold: 1 }] } });
    const text = await compareServerGate(passedGate, passedGate, "unchanged", baseline);
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).not.toContain("**NEUTRAL**");
  });

  it("rejects a stored neutral diff with absent source policies", async () => {
    const text = await compareServerGate({ passed: true }, { passed: true }, "unchanged");
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).not.toContain("**NEUTRAL**");
  });

  it("does not trust a stored regression caused by a changed threshold", async () => {
    const text = await compareServerGate(passedGate, { ...passedGate, passed: false, threshold: 5 }, "regressed");
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).toContain("not comparable (gate policy changed)");
    expect(text).not.toContain("**REGRESSION**");
    expect(text).toContain("original-diff-sha");
    expect(text).toContain("digest refers to the original backend diff");
    expect(text).toContain("signature not independently verified");
  });

  it("does not trust a stored neutral classification after an operator change", async () => {
    const text = await compareServerGate(passedGate, { ...passedGate, operator: "gte" }, "unchanged");
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).not.toContain("**NEUTRAL**");
  });

  it.each(["regressed", "improved", "still_failing"])("does not trust %s when a source boolean is missing", async (transition) => {
    const text = await compareServerGate({ ...passedGate, passed: null }, passedGate, transition);
    expect(text).toContain("**INSUFFICIENT EVIDENCE**");
    expect(text).toContain("unknown (missing pass/fail evidence)");
    expect(text).not.toContain("**REGRESSION**");
    expect(text).not.toContain("RECOVERY");
  });

  it("derives a real regression from outcomes even if the stored transition says unchanged", async () => {
    const text = await compareServerGate(passedGate, { ...passedGate, passed: false, actual_value: 11 }, "unchanged");
    expect(text).toContain("**REGRESSION** ✓→✗");
  });
});
