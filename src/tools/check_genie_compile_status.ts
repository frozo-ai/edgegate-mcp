import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import { surfaceCompileGenieError } from "./compile_genie.js";

export const checkGenieCompileStatusInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    job_id: z.string().uuid().describe("The job_id returned by edgegate_compile_genie."),
  })
  .strict();

export type CheckGenieCompileStatusInput = z.infer<typeof checkGenieCompileStatusInputSchema>;

export async function checkGenieCompileStatusHandler(
  client: EdgeGateClient,
  input: CheckGenieCompileStatusInput
): Promise<ToolResult> {
  try {
    const job = await client.getGenieCompileStatus(input.workspace_id, input.job_id);

    const lines = [
      `Genie-compile job ${job.job_id}:`,
      ``,
      `- lane: ${job.lane}`,
      `- status: ${job.status}`,
    ];
    if (job.bundle_artifact_id) {
      lines.push(`- bundle_artifact_id: ${job.bundle_artifact_id}`);
      lines.push(
        ``,
        `Done. Pass \`bundle_artifact_id\` into \`edgegate_create_bg_run\` along with the ` +
          `published eval set and reference oracle.`
      );
    } else {
      lines.push(``, `Not done yet — poll again shortly.`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return surfaceCompileGenieError(err);
    }
    throw err;
  }
}
