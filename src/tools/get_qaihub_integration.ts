import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const getQaihubIntegrationInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type GetQaihubIntegrationInput = z.infer<typeof getQaihubIntegrationInputSchema>;

export async function getQaihubIntegrationHandler(
  client: EdgeGateClient,
  input: GetQaihubIntegrationInput,
): Promise<ToolResult> {
  try {
    const status = await client.getQaihubIntegration(input.workspace_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Qualcomm AI Hub integration: **${status.status}**`,
            ``,
            `- token: \`****${status.token_last4}\` (encrypted at rest)`,
            `- connected: ${status.created_at}`,
            `- last updated: ${status.updated_at}`,
            ``,
            status.status === "disabled"
              ? `The integration is paused — runs in this workspace will error with NO_AIHUB_TOKEN until it's re-enabled or rotated with a fresh token.`
              : `The token is being used for all compile + profile jobs against Qualcomm AI Hub.`,
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
              text: [
                `No Qualcomm AI Hub integration connected to this workspace.`,
                ``,
                `EdgeGate runs will error with \`NO_AIHUB_TOKEN\` until you connect a token. Get one at https://app.aihub.qualcomm.com/account/api-token and connect it via \`edgegate_connect_qaihub\`.`,
              ].join("\n"),
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
