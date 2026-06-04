import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { RunDetail } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const checkStatusInputSchema = z.object({
  workspace_id: z.string().uuid(),
  run_id: z.string().uuid(),
});

export type CheckStatusInput = z.infer<typeof checkStatusInputSchema>;

export async function checkStatusHandler(
  client: EdgeGateClient,
  input: CheckStatusInput
): Promise<ToolResult> {
  try {
    const run = await client.getRun(input.workspace_id, input.run_id);
    return { content: [{ type: "text", text: format(run) }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [{ type: "text", text: `EdgeGate returned ${err.status}: ${err.detail}` }],
      };
    }
    throw err;
  }
}

function format(run: RunDetail): string {
  const badge = run.status.toUpperCase();
  const lines: string[] = [
    `Run **${run.id}**: ${badge}`,
    `Pipeline: ${run.pipeline_id}`,
    `Trigger: ${run.trigger}`,
    `Started: ${run.started_at ?? "(pending)"}`,
    `Completed: ${run.completed_at ?? "(in flight)"}`,
    ``,
  ];
  for (const cell of run.cells ?? []) {
    lines.push(`### Cell: ${cell.device_name}`);
    for (const [m, v] of Object.entries(cell.metrics)) {
      lines.push(`- ${m}: ${v}`);
    }
    for (const gr of cell.gate_results ?? []) {
      const sym = gr.passed ? "✓" : "✗";
      lines.push(`  ${sym} ${gr.metric} ${gr.passed ? "≤" : ">"} ${gr.threshold} (actual ${gr.actual})`);
    }
    lines.push(``);
  }
  if (run.evidence_bundle_url) {
    lines.push(`Evidence bundle: ${run.evidence_bundle_url}`);
  }
  return lines.join("\n");
}
