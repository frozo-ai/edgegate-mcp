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
  name?: string;
  passed?: boolean;
  requirement_id?: string | null;
  asil?: string | null;
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
      requirements_traced: boolean;
      checks: IsoCheck[];
    };
    integrity: Record<string, unknown>;
  };
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
    const checks = ver.checks
      .map(
        (c) =>
          `  - ${c.name}: ${c.passed ? "PASS" : "FAIL"} | req ${c.requirement_id ?? "—"} · ASIL ${c.asil ?? "—"}`
      )
      .join("\n");

    const text = [
      `## ${rep.title} — ${rep.standard}`,
      `Run ${rep.run_id} · verdict **${rep.verdict}** · ${rep.tool.name} ${rep.tool.version}`,
      ``,
      `### Configuration (ISO 26262-8 cl.7)`,
      `- device: ${id.target_device ?? "—"}`,
      `- quantization: ${id.quantization ?? "—"}`,
      `- model_sha256: ${id.model_sha256 ?? "—"}`,
      `- eval_set_sha256: ${id.eval_set_sha256 ?? "—"}`,
      ``,
      `### Verification (ISO 26262-6 cl.9-10): ${ver.result} — ` +
        `${ver.checks_total - ver.checks_failed_count}/${ver.checks_total} passed · ` +
        `requirements_traced=${ver.requirements_traced}`,
      checks || "  (no checks)",
      ``,
      `### Integrity (ISO 26262-8 cl.10)`,
      `- ${integ.signature_algorithm}, key ${integ.signing_key_id ?? "(in bundle)"}`,
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
