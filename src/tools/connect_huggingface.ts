import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const connectHuggingfaceInputSchema = z.object({
  workspace_id: z.string().uuid(),
  token: z
    .string()
    .min(8)
    .describe(
      "Personal HuggingFace access token (starts with hf_). Generate one at " +
        "https://huggingface.co/settings/tokens — Read scope is enough for the " +
        "import flow.",
    ),
});

export type ConnectHuggingfaceInput = z.infer<typeof connectHuggingfaceInputSchema>;

export async function connectHuggingfaceHandler(
  client: EdgeGateClient,
  input: ConnectHuggingfaceInput,
): Promise<ToolResult> {
  try {
    const result = await client.connectHuggingFaceIntegration(
      input.workspace_id,
      input.token,
    );

    return {
      content: [
        {
          type: "text",
          text: [
            `Connected HuggingFace as **${result.account_name}** (${result.account_type}).`,
            ``,
            `- token: \`****${result.token_last4}\` (encrypted at rest, never echoed)`,
            `- status: ${result.status}`,
            ``,
            `EdgeGate will now use this token for \`edgegate_import_huggingface_model\` calls in this workspace, so private / gated / Qualcomm-org repos work end-to-end.`,
            `Rotate by calling this tool again with a fresh token; remove with \`edgegate_disconnect_huggingface\`.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 409) {
        // Integration already exists — try rotating instead.
        try {
          const rotated = await client.rotateHuggingFaceIntegration(
            input.workspace_id,
            input.token,
          );
          return {
            content: [
              {
                type: "text",
                text: [
                  `Replaced existing HuggingFace token for account **${rotated.account_name}**.`,
                  ``,
                  `- token: \`****${rotated.token_last4}\``,
                  `- status: ${rotated.status}`,
                ].join("\n"),
              },
            ],
          };
        } catch (rotateErr) {
          if (rotateErr instanceof EdgeGateError) {
            return formatError(rotateErr);
          }
          throw rotateErr;
        }
      }
      return formatError(err);
    }
    throw err;
  }
}

function formatError(err: EdgeGateError): ToolResult {
  if (err.status === 400) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `HuggingFace rejected the token: ${err.detail}\n\n` +
            `Generate a fresh token at https://huggingface.co/settings/tokens — the ` +
            `default "Read" scope is sufficient.`,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: `EdgeGate returned ${err.status}: ${err.detail}` }],
  };
}
