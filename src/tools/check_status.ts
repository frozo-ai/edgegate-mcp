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
    `Pipeline: ${run.pipeline_id} (${run.pipeline_name})`,
    `Trigger: ${run.trigger}`,
    `Started: ${run.created_at}`,
    `Completed: ${run.completed_at ?? "(in flight)"}`,
    ``,
  ];

  if (run.normalized_metrics) {
    lines.push(`### Metrics`);
    for (const [metric, value] of Object.entries(run.normalized_metrics)) {
      lines.push(`- ${metric}: ${value}`);
    }
    lines.push(``);
  }

  // Runs that errored before gate evaluation have gates_eval = null OR
  // gates_eval = {} without a `gates` array (e.g. CELL_EXECUTION_ERROR on
  // the first cell, orphaned matrix runs). Guard against `gates` being
  // missing — the prior code did `for (const gate of run.gates_eval.gates)`
  // and crashed with "run.gates_eval.gates is not iterable".
  if (run.gates_eval && Array.isArray(run.gates_eval.gates) && run.gates_eval.gates.length > 0) {
    lines.push(`### Gate Results`);
    for (const gate of run.gates_eval.gates) {
      const sym = gate.passed ? "✓" : "✗";
      lines.push(
        `  ${sym} ${gate.metric} ${gate.operator} ${gate.threshold} (actual ${gate.actual_value})`
      );
    }
    lines.push(`Overall: ${run.gates_eval.passed ? "PASSED" : "FAILED"}`);
    lines.push(``);
  }

  if (run.error_code) {
    lines.push(`Error: ${run.error_code}`);
    if (run.error_detail) lines.push(`Detail: ${run.error_detail}`);
    lines.push(``);
  }

  if (run.bundle_artifact_id) {
    lines.push(
      `Evidence bundle artifact: ${run.bundle_artifact_id}`,
      `Fetch bundle details with \`edgegate_get_audit_report\`.`
    );
  }

  return lines.join("\n");
}
