import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const changeMemberRoleInputSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z
    .string()
    .uuid()
    .describe("Target member's user_id (from `edgegate_list_members`)."),
  role: z
    .enum(["owner", "admin", "viewer"])
    .describe("The new role. Requires the caller to be a workspace owner."),
});

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleInputSchema>;

export async function changeMemberRoleHandler(
  client: EdgeGateClient,
  input: ChangeMemberRoleInput,
): Promise<ToolResult> {
  try {
    const member = await client.updateMemberRole(
      input.workspace_id,
      input.user_id,
      input.role,
    );
    return {
      content: [
        {
          type: "text",
          text: `Updated **${member.email}** to **${member.role}** in this workspace.`,
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 400) {
        // Most likely "Cannot remove the last owner from workspace".
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Role change rejected: ${err.detail}\n\n` +
                `If you're trying to downgrade the last owner, first promote ` +
                `another member to owner via this tool, then come back to ` +
                `downgrade the original owner.`,
            },
          ],
        };
      }
      if (err.status === 404) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `User \`${input.user_id}\` is not a member of this workspace.`,
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
