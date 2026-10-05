import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { exportComplianceReportHandler } from "../../src/tools/export_compliance_report.js";

const apiUrl = "https://api.test";
const wsId = "11111111-1111-1111-1111-111111111111";
const runId = "22222222-2222-2222-2222-222222222222";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

function report(verification: Record<string, unknown>, identification: Record<string, unknown> = {}) {
  return {
    title: "Model Verification Evidence",
    standard: "ISO 26262-6 / ISO 26262-8 (2018)",
    run_id: runId,
    verdict: "PASS",
    tool: { name: "EdgeGate", version: "0.1.0" },
    disclaimer: "Verification evidence, not a compliance certification.",
    sections: {
      item_identification: identification,
      verification: { requirements_traced: false, ...verification },
      integrity: { signature_algorithm: "Ed25519", evidence_bundle_artifact_id: "bundle-1" },
    },
  };
}

async function render(payload: ReturnType<typeof report>) {
  server.use(http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/compliance-report`, () => HttpResponse.json(payload)));
  const result = await exportComplianceReportHandler(new EdgeGateClient({ apiUrl, apiKey: "egk_test_x" }), {
    workspace_id: wsId, run_id: runId,
  });
  expect(result.isError).toBeUndefined();
  return result.content[0].text;
}

describe("export_compliance_report evidence rendering", () => {
  it("renders named scoped matrix checks and counts explicit passes", async () => {
    const text = await render(report({
      result: "PASS", checks_total: 2, checks_passed_count: 2, checks_failed_count: 0, checks_unknown_count: 0,
      checks: [
        { name: "inference_time_ms", passed: true, model_label: "MobileNetV2 fp32", device_name: "device-1" },
        { name: "inference_time_ms", passed: true, model_label: "MobileNetV2 int8", device_name: "device-2" },
      ],
      rollup: { cells_passed: 2, cells_total: 2 },
    }, { target_devices: ["device-1", "device-2"], model_sha256: "a".repeat(64), execution_backend: "ai_hub_device" }));
    expect(text).toContain("PASS — 2/2 passed · 0 failed · 0 unknown");
    expect(text).toContain("inference_time_ms [MobileNetV2 int8 / device-2]: PASS");
    expect(text).toContain("device: device-1, device-2");
    expect(text).toContain("execution backend: ai_hub_device");
    expect(text).toContain("cell counts, not individual gate counts");
    expect(text).toContain("Signature verification was not performed");
    expect(text).toContain("not a compliance certification");
  });

  it("does not turn a legacy unnamed matrix rollup into a failed gate", async () => {
    const text = await render(report({
      result: "PASS", checks_total: 1, checks_failed_count: 1,
      checks: [{ name: null, passed: false }],
    }));
    expect(text).toContain("recorded run verdict **PASS**");
    expect(text).toContain("UNKNOWN — 0/1 passed · 0 failed · 1 unknown");
    expect(text).toContain("unnamed check: UNKNOWN");
    expect(text).not.toContain("null: FAIL");
    expect(text).not.toContain("PASS — 0/1 passed");
    expect(text).toContain("device: unknown (not supplied)");
  });

  it("labels absent and malformed outcomes unknown rather than counting them as passes", async () => {
    const text = await render(report({
      result: "UNKNOWN", checks_total: 3, checks_failed_count: 0, checks_unknown_count: 2,
      checks: [{ name: "ok", passed: true }, { name: "missing" }, { name: "malformed", passed: "false" }],
    }));
    expect(text).toContain("UNKNOWN — 1/3 passed · 0 failed · 2 unknown");
    expect(text).toContain("missing: UNKNOWN");
    expect(text).toContain("malformed: UNKNOWN");
  });

  it("does not invent check counts when only the matrix rollup is available", async () => {
    const text = await render(report({
      result: "UNKNOWN", checks_total: 0, checks_failed_count: 0, checks: [],
      evidence_notes: ["Only matrix rollup evidence is available; named checks were not supplied."],
      rollup: { cells_passed: 9, cells_total: 9 },
    }));
    expect(text).toContain("UNKNOWN — 0/0 passed");
    expect(text).toContain("no individual check evidence available");
    expect(text).toContain("Only matrix rollup evidence is available");
    expect(text).not.toContain("9/9 passed");
  });

  it("preserves a real failure even when the recorded run verdict disagrees", async () => {
    const text = await render(report({
      result: "PASS", checks_total: 1, checks_failed_count: 1,
      checks: [{ name: "safety_probe_pass_rate", passed: false, criticality: "hard" }],
    }));
    expect(text).toContain("FAIL — 0/1 passed · 1 failed · 0 unknown");
    expect(text).toContain("Reported verification result PASS is not supported");
  });

  it("labels soft failures advisory without changing a passing gate verdict", async () => {
    const text = await render(report({
      result: "PASS", checks_total: 2, checks_failed_count: 1,
      checks: [{ name: "hard", passed: true, criticality: "hard" }, { name: "soft", passed: false, criticality: "soft" }],
    }));
    expect(text).toContain("PASS — 1/2 passed · 1 failed · 0 unknown");
    expect(text).toContain("soft: FAIL (advisory)");
  });

  it("flags mismatched summary totals instead of deriving passes by subtraction", async () => {
    const text = await render(report({ result: "PASS", checks_total: 10, checks_failed_count: 0, checks: [{ name: "one", passed: true }] }));
    expect(text).toContain("UNKNOWN — 1/1 passed");
    expect(text).toContain("Reported totals do not match");
    expect(text).not.toContain("10/10 passed");
  });

  it("preserves unknown criticality instead of declaring a hard-gate failure", async () => {
    const text = await render(report({
      result: "UNKNOWN", checks_total: 2, checks_failed_count: 1,
      checks: [{ name: "hard", passed: true, criticality: "hard" }, { name: "policy_missing", passed: false, criticality: "unknown" }],
    }, { model_sha256: "a".repeat(64), model_sha256_scope: "primary_model_artifact" }));
    expect(text).toContain("UNKNOWN — 1/2 passed · 1 failed · 0 unknown");
    expect(text).toContain("policy_missing: FAIL (policy unknown)");
    expect(text).toContain("model hash scope: primary_model_artifact");
  });

  it("does not claim PASS for an explicitly partial set of matrix check rows", async () => {
    const text = await render(report({
      result: "PASS", checks_total: 1, checks_failed_count: 0, evidence_status: "partial",
      checks: [{ name: "one", passed: true }],
    }));
    expect(text).toContain("UNKNOWN — 1/1 passed");
  });

  it("reports an unavailable endpoint without hiding authorization or server errors", async () => {
    server.use(http.get(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/compliance-report`, () => HttpResponse.json({ detail: "forbidden" }, { status: 403 })));
    const result = await exportComplianceReportHandler(new EdgeGateClient({ apiUrl, apiKey: "egk_test_x" }), { workspace_id: wsId, run_id: runId });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("admin access");
  });
});
