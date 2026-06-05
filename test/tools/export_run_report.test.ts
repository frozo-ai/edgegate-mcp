import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { EdgeGateClient } from "../../src/client.js";
import { exportRunReportHandler } from "../../src/tools/export_run_report.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const runId = "e68b4747-cb28-4765-8415-f4bc83166476";
const pipelineId = "aaaa0000-0000-0000-0000-000000000001";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

// ─── Shared fixtures ───────────────────────────────────────────────────────

function makeRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: runId,
    pipeline_id: pipelineId,
    pipeline_name: "edge-regression",
    status: "passed",
    trigger: "manual",
    model_artifact_id: "art-00000000-0000-0000-0000-000000000001",
    model_filename: "mobilenet.onnx",
    error_code: null,
    error_detail: null,
    created_at: "2026-06-04T10:00:00Z",
    updated_at: "2026-06-04T10:10:00Z",
    completed_at: "2026-06-04T10:08:30Z",
    hub_model_id: "hub-model-1",
    hub_job_id: "hub-job-1",
    normalized_metrics: { inference_time_ms: 8.4, peak_memory_mb: 120 },
    gates_eval: {
      passed: true,
      gates: [
        {
          metric: "inference_time_ms",
          passed: true,
          operator: "lte",
          threshold: 100,
          description: null,
          actual_value: 8.4,
        },
        {
          metric: "peak_memory_mb",
          passed: true,
          operator: "lte",
          threshold: 150,
          description: null,
          actual_value: 120,
        },
      ],
    },
    bundle_artifact_id: "bundle-00000000-0000-0000-0000-000000000001",
    ...overrides,
  };
}

function makeBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: runId,
    status: "passed",
    pipeline_id: pipelineId,
    pipeline_name: "edge-regression",
    normalized_metrics: { inference_time_ms: 8.4, peak_memory_mb: 120 },
    gates_eval: {
      passed: true,
      gates: [
        {
          metric: "inference_time_ms",
          passed: true,
          operator: "lte",
          threshold: 100,
          description: null,
          actual_value: 8.4,
        },
        {
          metric: "peak_memory_mb",
          passed: true,
          operator: "lte",
          threshold: 150,
          description: null,
          actual_value: 120,
        },
      ],
    },
    bundle_artifact_id: "bundle-00000000-0000-0000-0000-000000000001",
    ...overrides,
  };
}

function makeDiff(): Record<string, unknown> {
  return {
    current_run_id: runId,
    previous_run_id: "bbbb0000-0000-0000-0000-000000000001",
    diff_sha256: "abc123sha",
    diff: {
      current_run_id: runId,
      previous_run_id: "bbbb0000-0000-0000-0000-000000000001",
      current_commit: {},
      previous_commit: {},
      current_completed_at: "2026-06-04T10:08:30Z",
      previous_completed_at: "2026-06-03T10:08:30Z",
      metric_deltas: {
        inference_time_ms: { current: 8.4, previous: 9.0, delta: -0.6, delta_pct: -6.67 },
        peak_memory_mb: { current: 120, previous: 125, delta: -5, delta_pct: -4.0 },
      },
      gate_flips: [
        {
          metric: "inference_time_ms",
          transition: "unchanged",
          previous: { passed: true, threshold: 100, operator: "lte", actual_value: 9.0 },
          current: { passed: true, threshold: 100, operator: "lte", actual_value: 8.4 },
        },
      ],
      per_device: null,
      per_cell: null,
      is_baseline: false,
    },
    created_at: "2026-06-04T10:10:00Z",
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("export_run_report — writes file when output_path is a file path", () => {
  it("writes the report and returns file path + preview", async () => {
    const outPath = join(tmpdir(), `edgegate-test-${Date.now()}.md`);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json(makeRun())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/bundle`, () =>
        HttpResponse.json(makeBundle())
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await exportRunReportHandler(client, {
      workspace_id: wsId,
      run_id: runId,
      output_path: outPath,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain(`Wrote run report to ${outPath}`);
    expect(text).toContain("# EdgeGate Run Report");

    // Verify file was written with correct content
    const written = await readFile(outPath, "utf8");
    expect(written).toContain("# EdgeGate Run Report");
    expect(written).toContain(runId);
    expect(written).toContain("PASSED");
    expect(written).toContain("inference_time_ms");
    expect(written).toContain("8.4");
    expect(written).toMatch(/edgegate-mcp@\d+\.\d+\.\d+/);

    // Cleanup
    await rm(outPath, { force: true });
  });
});

describe("export_run_report — default path when output_path omitted", () => {
  it("writes to ./edgegate-run-{id-short}.md and returns the resolved path", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json(makeRun())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/bundle`, () =>
        HttpResponse.json(makeBundle())
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await exportRunReportHandler(client, {
      workspace_id: wsId,
      run_id: runId,
      // output_path deliberately omitted
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // Default filename pattern
    const idShort = runId.slice(0, 8);
    expect(text).toContain(`edgegate-run-${idShort}.md`);

    // Cleanup the default path (in CWD)
    const defaultPath = join(process.cwd(), `edgegate-run-${idShort}.md`);
    await rm(defaultPath, { force: true });
  });
});

describe("export_run_report — ~ expansion", () => {
  it("expands ~ to home dir and writes the file", async () => {
    const { homedir } = await import("node:os");
    const home = homedir();
    const filename = `edgegate-tilde-test-${Date.now()}.md`;
    const tildeRelPath = `~/${filename}`;
    const expectedPath = join(home, filename);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json(makeRun())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/bundle`, () =>
        HttpResponse.json(makeBundle())
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await exportRunReportHandler(client, {
      workspace_id: wsId,
      run_id: runId,
      output_path: tildeRelPath,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(expectedPath);

    // Verify file is there
    const written = await readFile(expectedPath, "utf8");
    expect(written).toContain("# EdgeGate Run Report");

    await rm(expectedPath, { force: true });
  });
});

describe("export_run_report — directory path", () => {
  it("appends edgegate-run-{id-short}.md when output_path is an existing directory", async () => {
    const dirPath = join(tmpdir(), `edgegate-dir-test-${Date.now()}`);
    await mkdir(dirPath, { recursive: true });

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json(makeRun())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/bundle`, () =>
        HttpResponse.json(makeBundle())
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await exportRunReportHandler(client, {
      workspace_id: wsId,
      run_id: runId,
      output_path: dirPath,
    });

    expect(result.isError).toBeUndefined();
    const idShort = runId.slice(0, 8);
    const expectedFile = join(dirPath, `edgegate-run-${idShort}.md`);
    expect(result.content[0].text).toContain(expectedFile);

    const written = await readFile(expectedFile, "utf8");
    expect(written).toContain("# EdgeGate Run Report");

    await rm(dirPath, { recursive: true, force: true });
  });
});

describe("export_run_report — in-flight run (no bundle)", () => {
  it("gracefully omits bundle/gate sections and does not crash", async () => {
    const outPath = join(tmpdir(), `edgegate-inflight-${Date.now()}.md`);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json(
          makeRun({
            status: "running",
            completed_at: null,
            normalized_metrics: null,
            gates_eval: null,
            bundle_artifact_id: null,
          })
        )
      )
      // No bundle endpoint — server would error if called
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await exportRunReportHandler(client, {
      workspace_id: wsId,
      run_id: runId,
      output_path: outPath,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Wrote run report to");

    const written = await readFile(outPath, "utf8");
    expect(written).toContain("# EdgeGate Run Report");
    expect(written).toContain("_Run not yet complete — check back._");
    // Should NOT contain the Gate Results section
    expect(written).not.toContain("## Gate Results");
    expect(written).not.toContain("## Evidence Bundle");

    await rm(outPath, { force: true });
  });
});

describe("export_run_report — include_diff=true", () => {
  it("appends diff section when include_diff is true", async () => {
    const outPath = join(tmpdir(), `edgegate-diff-${Date.now()}.md`);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json(makeRun())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/bundle`, () =>
        HttpResponse.json(makeBundle())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/diff`, () =>
        HttpResponse.json(makeDiff())
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await exportRunReportHandler(client, {
      workspace_id: wsId,
      run_id: runId,
      output_path: outPath,
      include_diff: true,
    });

    expect(result.isError).toBeUndefined();

    const written = await readFile(outPath, "utf8");
    expect(written).toContain("## Run-vs-Baseline Diff");
    expect(written).toContain("abc123sha");
    expect(written).toContain("bbbb0000-0000-0000-0000-000000000001");
    expect(written).toContain("-0.60");

    await rm(outPath, { force: true });
  });

  it("omits diff section gracefully when backend returns 404", async () => {
    const outPath = join(tmpdir(), `edgegate-nodiff-${Date.now()}.md`);

    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}`, () =>
        HttpResponse.json(makeRun())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/bundle`, () =>
        HttpResponse.json(makeBundle())
      ),
      http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/diff`, () =>
        HttpResponse.json({ detail: "Not found" }, { status: 404 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await exportRunReportHandler(client, {
      workspace_id: wsId,
      run_id: runId,
      output_path: outPath,
      include_diff: true,
    });

    expect(result.isError).toBeUndefined();

    const written = await readFile(outPath, "utf8");
    expect(written).not.toContain("## Run-vs-Baseline Diff");
    expect(written).toContain("# EdgeGate Run Report");

    await rm(outPath, { force: true });
  });
});
