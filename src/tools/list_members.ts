import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import type { Member } from "../types.js";

export const listMembersInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type ListMembersInput = z.infer<typeof listMembersInputSchema>;

export async function listMembersHandler(
  client: EdgeGateClient,
  input: ListMembersInput,
): Promise<ToolResult> {
  try {
    const members = await client.listMembers(input.workspace_id);
    if (members.length === 0) {
      return {
        content: [
          { type: "text", text: "No members in this workspace yet (which should be impossible — the owner is always a member)." },
        ],
      };
    }
    return {
      content: [{ type: "text", text: formatTable(members) }],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [{ type: "text", text: `EdgeGate returned ${err.status}: ${err.detail}` }],
      };
    }
    throw err;
  }
}

function formatTable(members: Member[]): string {
  const lines: string[] = [
    `Found ${members.length} member${members.length === 1 ? "" : "s"} in this workspace:`,
    ``,
    `| email | role | user_id |`,
    `|---|---|---|`,
  ];
  for (const m of members) {
    lines.push(`| ${m.email} | ${m.role} | \`${m.user_id}\` |`);
  }
  lines.push(
    ``,
    `Invite with \`edgegate_invite_member\`, change role with \`edgegate_change_member_role\`, remove with \`edgegate_remove_member\`. Roles: \`owner\` (full control), \`admin\` (manage pipelines + runs, can't change billing or delete workspace), \`viewer\` (read-only).`,
  );
  return lines.join("\n");
}
