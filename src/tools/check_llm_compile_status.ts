import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { LLMCompileJob } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const checkLLMCompileStatusInputSchema = z.object({
  workspace_id: z.string().uuid(),
  compile_job_id: z.string().uuid(),
});

export type CheckLLMCompileStatusInput = z.infer<
  typeof checkLLMCompileStatusInputSchema
>;

export async function checkLLMCompileStatusHandler(
  client: EdgeGateClient,
  input: CheckLLMCompileStatusInput
): Promise<ToolResult> {
  try {
    const job = await client.getLLMCompileJob(
      input.workspace_id,
      input.compile_job_id
    );
    return { content: [{ type: "text", text: format(job) }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 404
                ? `No LLM compile job ${input.compile_job_id} in workspace ${input.workspace_id}.`
                : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}

function format(job: LLMCompileJob): string {
  const lines: string[] = [
    `LLM compile job **${job.compile_job_id}**: ${job.status.toUpperCase()}`,
    `- progress: ${job.progress.compile_jobs_done}/${job.progress.compile_jobs_total} compile jobs done`,
  ];
  if (job.device_id) lines.push(`- device: ${job.device_id}`);
  if (job.target_runtime) lines.push(`- target_runtime: ${job.target_runtime}`);

  if (job.status === "completed") {
    lines.push(
      ``,
      `Composite artifact ready:`,
      `- composite_artifact_id: ${job.composite_artifact_id}`,
      ``,
      `Reference it from a pipeline via:`,
      `  models: [{ name: "...", artifact_id: "${job.composite_artifact_id}" }]`
    );
  } else if (job.status === "failed") {
    lines.push(``, `Error: ${job.error_detail ?? "unknown"}`);
  } else {
    lines.push(``, `Still in flight. Re-poll in ~30s.`);
  }

  return lines.join("\n");
}
