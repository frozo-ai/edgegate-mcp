import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const createWorkspaceInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .describe("Display name for the new workspace, e.g. \"MobileNet Production\"."),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export async function createWorkspaceHandler(
  client: EdgeGateClient,
  input: CreateWorkspaceInput,
): Promise<ToolResult> {
  try {
    const ws = await client.createWorkspace(input.name);
    return {
      content: [
        {
          type: "text",
          text: [
            `Created workspace **${ws.name}** — you are the owner.`,
            ``,
            `- workspace_id: \`${ws.id}\``,
            `- plan: ${ws.plan ?? "(unknown)"}`,
            ``,
            `Next: connect Qualcomm AI Hub via \`edgegate_connect_qaihub\`, then start defining pipelines with \`edgegate_create_pipeline\`. Pass \`workspace_id\` to every subsequent tool call so they operate on this workspace.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 403) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Workspace creation blocked: ${err.detail}\n\n` +
                `If you've hit your plan's workspace limit, upgrade at https://edgegate.frozo.ai/pricing.`,
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
