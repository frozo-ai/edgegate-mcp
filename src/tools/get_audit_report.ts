import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const getAuditReportInputSchema = z.object({
  workspace_id: z.string().uuid(),
  run_id: z.string().uuid(),
});

export type GetAuditReportInput = z.infer<typeof getAuditReportInputSchema>;

export async function getAuditReportHandler(
  client: EdgeGateClient,
  input: GetAuditReportInput
): Promise<ToolResult> {
  try {
    const report = await client.getAuditReport(input.workspace_id, input.run_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Audit report for run ${input.run_id}:`,
            ``,
            `Download URL: ${report.url}`,
            `Generated: ${report.generated_at}`,
            ``,
            `The URL is signed and time-limited (typically 1h). The PDF contains ` +
              `the signed evidence bundle hash, device fingerprints, and gate decisions — ` +
              `keep it with your compliance records.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 404
                ? `No audit report for run ${input.run_id} yet. Reports are generated ` +
                  `asynchronously after the run completes — try again in 1-2 minutes.`
                : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
