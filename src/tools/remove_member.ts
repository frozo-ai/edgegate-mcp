import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const removeMemberInputSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z
    .string()
    .uuid()
    .describe(
      "Target member's user_id (from `edgegate_list_members`). The user immediately " +
        "loses access to the workspace. Their pipelines and runs are preserved — " +
        "this only removes the membership row.",
    ),
});

export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>;

export async function removeMemberHandler(
  client: EdgeGateClient,
  input: RemoveMemberInput,
): Promise<ToolResult> {
  try {
    await client.removeMember(input.workspace_id, input.user_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Removed user \`${input.user_id}\` from this workspace.`,
            ``,
            `Pipelines and runs they created are preserved. Re-invite any time with \`edgegate_invite_member\` if it was a mistake.`,
          ].join("\n"),
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
                `Member removal rejected: ${err.detail}\n\n` +
                `If you're trying to remove the last owner, promote another member ` +
                `to owner first via \`edgegate_change_member_role\`, then remove ` +
                `the original owner.`,
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
