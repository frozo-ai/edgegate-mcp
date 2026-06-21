import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import { surfaceReferenceError } from "./capture_reference.js";

export const checkReferenceCaptureStatusInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    job_id: z.string().uuid().describe("The job_id returned by edgegate_capture_reference."),
  })
  .strict();

export type CheckReferenceCaptureStatusInput = z.infer<
  typeof checkReferenceCaptureStatusInputSchema
>;

export async function checkReferenceCaptureStatusHandler(
  client: EdgeGateClient,
  input: CheckReferenceCaptureStatusInput
): Promise<ToolResult> {
  try {
    const job = await client.getReferenceCaptureStatus(input.workspace_id, input.job_id);

    const lines = [`Reference-capture job ${job.job_id}:`, ``, `- status: ${job.status}`];
    if (job.reference_artifact_id) {
      lines.push(`- reference_artifact_id: ${job.reference_artifact_id}`);
      lines.push(
        ``,
        `Done. Pass \`reference_artifact_id\` into \`edgegate_create_bg_run\` as the ` +
          `gate's trustworthy baseline.`
      );
    } else {
      lines.push(``, `Not done yet — poll again shortly.`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return surfaceReferenceError(err);
    }
    throw err;
  }
}
