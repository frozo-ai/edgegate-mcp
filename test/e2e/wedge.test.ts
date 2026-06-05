/**
 * End-to-end wedge test — the truth gate for v1.0.
 *
 * This test EXERCISES THE FULL FLOW against a live staging EdgeGate:
 *   setup_workspace → create_pipeline → run_gate → check_status (poll) →
 *   get_report → setup_github_action
 *
 * It is NOT msw-mocked. It will burn ~10 minutes of wall clock and one real
 * AI Hub job per cell. Skipped automatically unless the four envs below are
 * set; CI gates this behind a manual workflow_dispatch.
 *
 * Per spec at docs/superpowers/specs/2026-06-04-mcp-server-design.md §8.3.
 */
import { describe, expect, it } from "vitest";
import { EdgeGateClient } from "../../src/client.js";
import { setupWorkspaceHandler } from "../../src/tools/setup_workspace.js";
import { createPipelineHandler } from "../../src/tools/create_pipeline.js";
import { runGateHandler } from "../../src/tools/run_gate.js";
import { checkStatusHandler } from "../../src/tools/check_status.js";
import { getReportHandler } from "../../src/tools/get_report.js";
import { setupGithubActionHandler } from "../../src/tools/setup_github_action.js";

const apiUrl = process.env.EDGEGATE_E2E_API_URL ?? "";
const apiKey = process.env.EDGEGATE_E2E_API_KEY ?? "";
const wsId = process.env.EDGEGATE_E2E_WORKSPACE_ID ?? "";
const artifactId = process.env.EDGEGATE_E2E_MODEL_ARTIFACT_ID ?? "";

const skip = !apiUrl || !apiKey || !wsId || !artifactId;

(skip ? describe.skip : describe)("wedge test — full v1.0 flow against live EdgeGate", () => {
  it("walks setup → create → run → poll → report → ghaction", { timeout: 900_000 }, async () => {
    const client = new EdgeGateClient({ apiUrl, apiKey });

    // Step 1: setup_workspace
    const setup = await setupWorkspaceHandler(client, { workspace_id: wsId });
    expect(setup.isError).toBeUndefined();
    expect(setup.content[0].text).toContain(wsId);

    // Step 2: create_pipeline
    const pipelineName = `wedge-${Date.now()}`;
    const create = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: pipelineName,
      // Use the string promptpack_id (not the UUID row id)
      promptpack_id: "image-classification-bench-v1",
      promptpack_version: "1.0.0",
      devices: ["Samsung Galaxy S24 (Family)"],
      gates: [
        { metric: "inference_time_ms", operator: "<=", threshold: 100 },
        { metric: "peak_memory_mb", operator: "<=", threshold: 500 },
      ],
      // Single model supplied per-run; omit models array for legacy mode
    });
    expect(create.isError).toBeUndefined();
    const pipelineId = extractUuid(create.content[0].text);
    expect(pipelineId).toBeTruthy();

    // Step 3: run_gate — supply the model artifact for single-model (legacy) mode
    const run = await runGateHandler(client, {
      workspace_id: wsId,
      pipeline_id: pipelineId!,
      model_artifact_id: artifactId,
    });
    expect(run.isError).toBeUndefined();
    const runId = extractUuid(run.content[0].text);
    expect(runId).toBeTruthy();

    // Step 4: poll until terminal — up to 12 min
    let status = "pending";
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      await sleep(10_000);
      const poll = await checkStatusHandler(client, { workspace_id: wsId, run_id: runId! });
      const text = poll.content[0].text;
      if (text.includes("PASSED")) { status = "passed"; break; }
      if (text.includes("FAILED")) { status = "failed"; break; }
      if (text.includes("ERROR")) { status = "error"; break; }
    }
    expect(["passed", "failed"]).toContain(status);

    // Step 5: get_report — the run we just made must appear
    const report = await getReportHandler(client, { workspace_id: wsId, limit: 5 });
    expect(report.content[0].text).toContain(runId!);

    // Step 6: setup_github_action — must produce YAML + gh commands
    const ghaction = await setupGithubActionHandler(client, {
      workspace_id: wsId,
      pipeline_id: pipelineId!,
    });
    expect(ghaction.content[0].text).toContain(".github/workflows/edgegate.yml");
    expect(ghaction.content[0].text).toContain("gh secret set");
  });
});

function extractUuid(text: string): string | null {
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
