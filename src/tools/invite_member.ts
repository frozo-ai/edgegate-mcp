import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const inviteMemberInputSchema = z.object({
  workspace_id: z.string().uuid(),
  user_email: z
    .string()
    .email()
    .describe(
      "Email of an existing EdgeGate user to add. The user must already have " +
        "an EdgeGate account — this tool does NOT send invitation emails to " +
        "external addresses (v1 only attaches existing users).",
    ),
  role: z
    .enum(["owner", "admin", "viewer"])
    .describe(
      "Their role in this workspace. `owner` = full control including billing " +
        "and member management; `admin` = can manage pipelines and runs but not " +
        "billing or delete the workspace; `viewer` = read-only.",
    ),
});

export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>;

export async function inviteMemberHandler(
  client: EdgeGateClient,
  input: InviteMemberInput,
): Promise<ToolResult> {
  try {
    const member = await client.addMember(input.workspace_id, {
      user_email: input.user_email,
      role: input.role,
    });
    return {
      content: [
        {
          type: "text",
          text: [
            `Added **${member.email}** to this workspace as **${member.role}**.`,
            ``,
            `- user_id: \`${member.user_id}\``,
            ``,
            `They can now sign in and access the workspace at their permission level. Change their role with \`edgegate_change_member_role\` or remove them with \`edgegate_remove_member\`.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 404) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `No EdgeGate user with email \`${input.user_email}\` found.\n\n` +
                `EdgeGate v1 only adds existing users — they need to register at ` +
                `https://edgegate.frozo.ai/register first, then re-run this tool.`,
            },
          ],
        };
      }
      if (err.status === 409) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `\`${input.user_email}\` is already a member of this workspace. Use \`edgegate_change_member_role\` to update their role.`,
            },
          ],
        };
      }
      if (err.status === 403) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Add-member blocked: ${err.detail}\n\n` +
                `Common causes: only owners can add other owners, or the workspace seat limit is reached. ` +
                `Upgrade at https://edgegate.frozo.ai/pricing if it's a plan limit.`,
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
