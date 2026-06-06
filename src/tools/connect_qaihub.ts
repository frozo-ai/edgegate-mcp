import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const connectQaihubInputSchema = z.object({
  workspace_id: z.string().uuid(),
  token: z
    .string()
    .min(8)
    .describe(
      "Qualcomm AI Hub API token. Generate one at " +
        "https://app.aihub.qualcomm.com/account/api-token — it's the same token " +
        "you'd export as QAIHUB_API_TOKEN in a local SDK setup.",
    ),
});

export type ConnectQaihubInput = z.infer<typeof connectQaihubInputSchema>;

export async function connectQaihubHandler(
  client: EdgeGateClient,
  input: ConnectQaihubInput,
): Promise<ToolResult> {
  try {
    const result = await client.connectQaihubIntegration(
      input.workspace_id,
      input.token,
    );
    return successText(result, "Connected");
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 409) {
        // Already exists — rotate transparently. Users don't have to think
        // about "is there already a token here" — the right thing happens
        // on the second call too.
        try {
          const rotated = await client.rotateQaihubIntegration(
            input.workspace_id,
            input.token,
          );
          return successText(rotated, "Replaced");
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

function successText(
  result: { token_last4: string; status: string },
  verb: "Connected" | "Replaced",
): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: [
          `${verb} Qualcomm AI Hub integration for this workspace.`,
          ``,
          `- token: \`****${result.token_last4}\` (encrypted at rest, never echoed)`,
          `- status: ${result.status}`,
          ``,
          `EdgeGate runs in this workspace will now use this token to compile + profile models on real Snapdragon devices via Qualcomm AI Hub.`,
        ].join("\n"),
      },
    ],
  };
}

function formatError(err: EdgeGateError): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `EdgeGate returned ${err.status}: ${err.detail}` }],
  };
}
