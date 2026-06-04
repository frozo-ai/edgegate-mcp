import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const runGateInputSchema = z.object({
  workspace_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  model_artifact_id: z.string().uuid().optional(),
});

export type RunGateInput = z.infer<typeof runGateInputSchema>;

export async function runGateHandler(
  client: EdgeGateClient,
  input: RunGateInput
): Promise<ToolResult> {
  try {
    const run = await client.triggerRun(input.workspace_id, input.pipeline_id, {
      trigger: "mcp",
      model_artifact_id: input.model_artifact_id,
    });
    return {
      content: [
        {
          type: "text",
          text: [
            `Triggered run **${run.id}** on pipeline ${input.pipeline_id}.`,
            ``,
            `Poll status with:`,
            `  \`edgegate_check_status({ workspace_id: "${input.workspace_id}", run_id: "${run.id}" })\``,
            ``,
            `Typical end-to-end time: 3-5 minutes per device.`,
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
              err.status === 409
                ? `Another run is in flight in this workspace. EdgeGate enforces ` +
                  `workspace_concurrency=1. Wait for it to finish, then retry.`
                : `Failed to trigger run: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
