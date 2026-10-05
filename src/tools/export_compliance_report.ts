import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Fetch the compliance-preset report for a run (e.g. ISO 26262 verification
 * evidence). Returns a readable rendering of the signed-evidence-derived report;
 * the formatted assessor PDF is downloadable from the run page in the dashboard.
 */
export const exportComplianceReportInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    run_id: z.string().uuid(),
    preset: z
      .enum(["iso26262"])
      .optional()
      .describe('Compliance preset. Default "iso26262".'),
  })
  .strict();

export type ExportComplianceReportInput = z.infer<typeof exportComplianceReportInputSchema>;

interface IsoCheck {
  name?: string | null;
  passed?: boolean | null;
  criticality?: string;
  requirement_id?: string | null;
  asil?: string | null;
  model_label?: string | null;
  model_artifact_id?: string | null;
  device_name?: string | null;
}
interface IsoReport {
  title: string;
  standard: string;
  run_id: string;
  verdict: string;
  disclaimer: string;
  tool: { name: string; version: string };
  sections: {
    item_identification: Record<string, unknown>;
    verification: {
      result: string;
      checks_total: number;
      checks_failed_count: number;
      checks_passed_count?: number;
      checks_unknown_count?: number;
      requirements_traced: boolean;
      checks: IsoCheck[];
      warnings?: string[];
      evidence_notes?: string[];
      evidence_status?: string;
      rollup?: Record<string, unknown>;
    };
    integrity: Record<string, unknown>;
  };
}

function supplied(value: unknown): string {
  if (value === null || value === undefined || value === "") return "unknown (not supplied)";
  if (Array.isArray(value)) return value.length ? value.map(supplied).join(", ") : "unknown (not supplied)";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Missing or unsupported outcomes are not failures, and are never counted as passes. */
function checkOutcome(check: IsoCheck): "PASS" | "FAIL" | "UNKNOWN" {
  if (typeof check.name !== "string" || !check.name.trim()) return "UNKNOWN";
  return check.passed === true ? "PASS" : check.passed === false ? "FAIL" : "UNKNOWN";
}

export async function exportComplianceReportHandler(
  client: EdgeGateClient,
  input: ExportComplianceReportInput
): Promise<ToolResult> {
  try {
    const rep = (await client.getComplianceReport(
      input.workspace_id,
      input.run_id,
      input.preset ?? "iso26262"
    )) as unknown as IsoReport;

    const id = rep.sections.item_identification;
    const ver = rep.sections.verification;
    const integ = rep.sections.integrity;
    const rows = Array.isArray(ver.checks) ? ver.checks.map((c) => c ?? {}) : [];
    const passed = rows.filter((c) => checkOutcome(c) === "PASS").length;
    const failed = rows.filter((c) => checkOutcome(c) === "FAIL").length;
    const unknown = rows.length - passed - failed;
    const hardFailed = rows.some((c) => checkOutcome(c) === "FAIL" &&
      (c.criticality === "hard" || c.criticality === undefined));
    const inconsistentCounts = ver.checks_total !== rows.length ||
      ver.checks_failed_count !== failed ||
      (ver.checks_passed_count !== undefined && ver.checks_passed_count !== passed) ||
      (ver.checks_unknown_count !== undefined && ver.checks_unknown_count !== unknown);
    const result = hardFailed ? "FAIL" :
      !rows.length || unknown || inconsistentCounts ||
      (ver.evidence_status !== undefined && ver.evidence_status !== "available") ? "UNKNOWN" : ver.result;
    const warnings = [...(Array.isArray(ver.warnings) ? ver.warnings : [])];
    if (inconsistentCounts) warnings.push("Reported totals do not match the available checks; counts below use the available check rows only.");
    if (result !== ver.result) warnings.push(`Reported verification result ${ver.result} is not supported by the available check rows; displayed result is ${result}.`);
    const checks = rows.map((c) => {
      const scope = [c.model_label ?? c.model_artifact_id, c.device_name].filter(Boolean).join(" / ");
      return `  - ${c.name || "unnamed check"}${scope ? ` [${scope}]` : ""}: ${checkOutcome(c)}` +
        `${c.criticality === "soft" ? " (advisory)" : c.criticality === "unknown" ? " (policy unknown)" : ""}` +
        ` | req ${c.requirement_id ?? "—"} · ASIL ${c.asil ?? "—"}`;
    }).join("\n");

    const text = [
      `## ${rep.title} — ${rep.standard}`,
      `Run ${rep.run_id} · recorded run verdict **${rep.verdict}** · ${rep.tool.name} ${rep.tool.version}`,
      ``,
      `### Configuration (ISO 26262-8 cl.7)`,
      `- execution backend: ${supplied(id.execution_backend)}`,
      `- device: ${supplied(id.target_device ?? id.target_devices)}`,
      `- quantization: ${supplied(id.quantization)}`,
      `- model_sha256: ${supplied(id.model_sha256)}`,
      ...(id.model_sha256_scope ? [`- model hash scope: ${supplied(id.model_sha256_scope)}`] : []),
      `- eval_set_sha256: ${supplied(id.eval_set_sha256)}`,
      ...(id.provenance ? [`- Field sources: ${supplied(id.provenance)}`] : []),
      ``,
      `### Verification (ISO 26262-6 cl.9-10): ${result} — ` +
        `${passed}/${rows.length} passed · ${failed} failed · ${unknown} unknown · ` +
        `requirements_traced=${ver.requirements_traced}`,
      checks || "  (no individual check evidence available)",
      ...(Array.isArray(ver.evidence_notes) ? ver.evidence_notes.map((note) => `- Evidence note: ${note}`) : []),
      ...warnings.map((warning) => `- Evidence note: ${warning}`),
      ...(ver.rollup ? [`- Recorded matrix rollup: ${JSON.stringify(ver.rollup)} (cell counts, not individual gate counts)`] : []),
      ``,
      `### Integrity (ISO 26262-8 cl.10)`,
      `- Reported signature algorithm: ${supplied(integ.signature_algorithm)}`,
      `- signing key: ${supplied(integ.signing_key_id)}`,
      `- evidence bundle: ${supplied(integ.evidence_bundle_artifact_id)}`,
      `- Signature verification was not performed by this export.`,
      ``,
      `> ${rep.disclaimer}`,
      ``,
      `The formatted assessor PDF is on the run page in the dashboard ("ISO 26262 Report").`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 404
                ? "Unknown run or workspace — re-check the ids."
                : err.status === 400
                  ? "Unsupported preset — only 'iso26262' is available."
                  : err.status === 403
                    ? "You need admin access on this workspace."
                    : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
