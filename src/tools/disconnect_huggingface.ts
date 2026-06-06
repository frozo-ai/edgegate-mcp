import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const disconnectHuggingfaceInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type DisconnectHuggingfaceInput = z.infer<typeof disconnectHuggingfaceInputSchema>;

export async function disconnectHuggingfaceHandler(
  client: EdgeGateClient,
  input: DisconnectHuggingfaceInput,
): Promise<ToolResult> {
  try {
    await client.deleteHuggingFaceIntegration(input.workspace_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Removed the HuggingFace integration for this workspace.`,
            ``,
            `The encrypted token has been deleted. Future \`edgegate_import_huggingface_model\` calls will use anonymous access — only repos with truly public ONNX files will work.`,
            ``,
            `Reconnect any time with \`edgegate_connect_huggingface\`.`,
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
              text:
                "No HuggingFace integration is currently connected to this workspace — nothing to remove.",
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
