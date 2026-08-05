import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Export the Field Recorder EU AI Act Article 12 record-keeping report — the
 * signed, hash-chained evidence for what deployed models did on-device over a
 * date range. Verification evidence, NOT a compliance certification. The
 * formatted assessor PDF is downloadable from the Field Recorder page.
 */
export const exportFieldRecorderReportInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    from: z.string().describe("Start of the reporting period (ISO 8601, e.g. 2026-06-01)."),
    to: z.string().describe("End of the reporting period (ISO 8601, e.g. 2026-07-01)."),
    device_id: z.string().optional().describe("Optional — restrict the report to a single device."),
  })
  .strict();

export type ExportFieldRecorderReportInput = z.infer<typeof exportFieldRecorderReportInputSchema>;

interface A12Clause {
  requirement?: string;
  status?: string;
  evidence?: string;
}
interface A12Report {
  tool?: string;
  tool_version?: string;
  workspace_id?: string;
  date_range?: { from?: string; to?: string };
  event_summary?: {
    total_events?: number;
    replayed?: number;
    passed?: number;
    diverged?: number;
  };
  article_12_mapping?: Record<string, A12Clause>;
  key_id?: string;
  signature?: string;
  disclaimer?: string;
}

const CLAUSE_ORDER: Array<[string, string]> = [
  ["12_1_automatic_recording", "12(1) Automatic recording"],
  ["12_2a_period_of_use", "12(2)(a) Period of use"],
  ["12_2b_reference_database", "12(2)(b) Reference database"],
  ["12_integrity", "Integrity (tamper-evident)"],
];

export async function exportFieldRecorderReportHandler(
  client: EdgeGateClient,
  input: ExportFieldRecorderReportInput
): Promise<ToolResult> {
  try {
    const rep = (await client.getFieldRecorderReport(
      input.workspace_id,
      input.from,
      input.to,
      input.device_id
    )) as unknown as A12Report;

    const es = rep.event_summary ?? {};
    const mapping = rep.article_12_mapping ?? {};
    const clauseLines = CLAUSE_ORDER.filter(([k]) => mapping[k]).map(([k, label]) => {
      const c = mapping[k];
      return `  - ${label}: ${c.status ?? "—"}\n      ${c.evidence ?? ""}`;
    });

    const text = [
      `## EU AI Act Article 12 — Record-Keeping Evidence`,
      `Workspace ${rep.workspace_id ?? input.workspace_id} · ${rep.date_range?.from ?? input.from} to ${rep.date_range?.to ?? input.to} · ${rep.tool ?? "EdgeGate Field Recorder"} ${rep.tool_version ?? ""}`,
      ``,
      `Events: ${es.total_events ?? 0} (replayed ${es.replayed ?? 0}, passed ${es.passed ?? 0}, diverged ${es.diverged ?? 0})`,
      ``,
      `### Article 12 mapping`,
      clauseLines.join("\n") || "  (no clauses mapped)",
      ``,
      `### Integrity`,
      `- Signature: Ed25519, report key ${rep.key_id ?? "—"}`,
      `- Report signature (b64): ${(rep.signature ?? "").slice(0, 64)}…`,
      ``,
      `> ${rep.disclaimer ?? "Verification evidence, not a compliance certification."}`,
      ``,
      `The formatted assessor PDF is on the Field Recorder page in the dashboard.`,
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
                ? "Unknown workspace — re-check the id."
                : err.status === 422
                  ? "Invalid date range — pass ISO 8601 'from' and 'to' (e.g. 2026-06-01)."
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
