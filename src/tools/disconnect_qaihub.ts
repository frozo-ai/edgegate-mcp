import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const disconnectQaihubInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type DisconnectQaihubInput = z.infer<typeof disconnectQaihubInputSchema>;

export async function disconnectQaihubHandler(
  client: EdgeGateClient,
  input: DisconnectQaihubInput,
): Promise<ToolResult> {
  try {
    await client.deleteQaihubIntegration(input.workspace_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Removed the Qualcomm AI Hub integration for this workspace.`,
            ``,
            `The encrypted token has been deleted. Any new EdgeGate runs in this workspace will fail with \`NO_AIHUB_TOKEN\` until a fresh token is connected via \`edgegate_connect_qaihub\`.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 404) {
        return {
          content: [
            {
              type: "text",
              text: "No Qualcomm AI Hub integration is currently connected to this workspace — nothing to remove.",
            },
          ],
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: `EdgeGate returned ${err.status}: ${err.detail}` }],
      };
    }
    throw err;
  }
}
