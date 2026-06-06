import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const getHuggingfaceIntegrationInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type GetHuggingfaceIntegrationInput = z.infer<
  typeof getHuggingfaceIntegrationInputSchema
>;

export async function getHuggingfaceIntegrationHandler(
  client: EdgeGateClient,
  input: GetHuggingfaceIntegrationInput,
): Promise<ToolResult> {
  try {
    const status = await client.getHuggingFaceIntegration(input.workspace_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `HuggingFace integration: **${status.status}**`,
            ``,
            `- token: \`****${status.token_last4}\` (encrypted at rest)`,
            `- connected: ${status.created_at}`,
            `- last updated: ${status.updated_at}`,
            ``,
            status.status === "disabled"
              ? `The integration is paused. Re-enable via the dashboard or rotate to refresh.`
              : `The token is being used for HuggingFace import calls in this workspace.`,
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
                `No HuggingFace integration connected to this workspace.`,
                ``,
                `Imports currently use anonymous access — only repos with truly public ONNX files work. To unlock private / gated / Qualcomm-org repos, call \`edgegate_connect_huggingface\` with a personal token from https://huggingface.co/settings/tokens.`,
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
