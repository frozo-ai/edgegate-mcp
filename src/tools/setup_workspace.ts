import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { Workspace } from "../types.js";

export const setupWorkspaceInputSchema = z.object({
  workspace_id: z
    .string()
    .uuid()
    .optional()
    .describe("Optional UUID. If omitted, lists all visible workspaces."),
});

export type SetupWorkspaceInput = z.infer<typeof setupWorkspaceInputSchema>;

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export async function setupWorkspaceHandler(
  client: EdgeGateClient,
  input: SetupWorkspaceInput
): Promise<ToolResult> {
  try {
    if (input.workspace_id) {
      const ws = await client.getWorkspace(input.workspace_id);
      return { content: [{ type: "text", text: formatSingle(ws) }] };
    }
    const list = await client.listWorkspaces();
    if (list.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              "No workspaces visible to this API key. The key may have been revoked, " +
              "or it was scoped to a deleted workspace. Generate a new one at " +
              "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys.",
          },
        ],
      };
    }
    return { content: [{ type: "text", text: formatList(list) }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 401
                ? "EDGEGATE_API_KEY is missing, expired, or revoked. Generate a fresh key at " +
                  "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys and retry."
                : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}

function formatSingle(ws: Workspace): string {
  return [
    `Active workspace: **${ws.name}**`,
    `- ID: ${ws.id}`,
    `- Plan: ${ws.plan}`,
    ``,
    `You can now use this workspace_id in the other EdgeGate MCP tools.`,
  ].join("\n");
}
function formatList(list: Workspace[]): string {
  const rows = list.map((w) => `- **${w.name}** (id=${w.id}, plan=${w.plan})`).join("\n");
  return [
    `Found ${list.length} workspace(s):`,
    ``,
    rows,
    ``,
    `Pick one and pass its id back as \`workspace_id\` to lock it in.`,
  ].join("\n");
}
