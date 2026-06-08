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
    const bundle = await client.getRunBundle(input.workspace_id, input.run_id);
    const lines: string[] = [
      `Evidence bundle for run ${input.run_id}:`,
      ``,
      `Status: ${bundle.status.toUpperCase()}`,
      `Pipeline: ${bundle.pipeline_id} (${bundle.pipeline_name})`,
      `Bundle artifact ID: ${bundle.bundle_artifact_id ?? "(not yet generated)"}`,
      ``,
    ];

    if (bundle.normalized_metrics) {
      lines.push(`### Metrics`);
      for (const [metric, value] of Object.entries(bundle.normalized_metrics)) {
        lines.push(`- ${metric}: ${value}`);
      }
      lines.push(``);
    }

    // gates_eval can be {} without a gates array on runs that errored
    // before evaluation. Guard or this crashes with "not iterable".
    if (
      bundle.gates_eval &&
      Array.isArray(bundle.gates_eval.gates) &&
      bundle.gates_eval.gates.length > 0
    ) {
      lines.push(`### Gate Decisions`);
      for (const gate of bundle.gates_eval.gates) {
        const sym = gate.passed ? "✓" : "✗";
        lines.push(
          `  ${sym} ${gate.metric} ${gate.operator} ${gate.threshold} (actual ${gate.actual_value})`
        );
      }
      lines.push(`Overall: ${bundle.gates_eval.passed ? "PASSED" : "FAILED"}`);
      lines.push(``);
    }

    lines.push(
      `The bundle artifact ID can be used with the EdgeGate API to download the ` +
        `signed evidence bundle containing the full SHA-256 manifest and device fingerprints.`
    );

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 409
                ? `Evidence bundle not available yet — the run has not completed. ` +
                  `Check status with \`edgegate_check_status\` and retry when it is PASSED or FAILED.`
                : err.status === 404
                  ? `No evidence bundle for run ${input.run_id} yet. ` +
                    `Bundles are generated after the run completes — try again in 1-2 minutes.`
                  : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
