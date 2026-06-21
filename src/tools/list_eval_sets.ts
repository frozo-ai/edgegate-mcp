import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import { surfaceEvalError } from "./create_eval_set.js";

export const listEvalSetsInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
  })
  .strict();

export type ListEvalSetsInput = z.infer<typeof listEvalSetsInputSchema>;

export async function listEvalSetsHandler(
  client: EdgeGateClient,
  input: ListEvalSetsInput
): Promise<ToolResult> {
  try {
    const sets = await client.listEvalSets(input.workspace_id);

    if (sets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              `No eval sets yet in this workspace.\n\n` +
              `Create one with \`edgegate_create_eval_set\` (optionally cloning a ` +
              `bundled pack from \`edgegate_list_eval_packs\`).`,
          },
        ],
      };
    }

    const header =
      `Found ${sets.length} eval set(s) in this workspace:\n\n` +
      `| eval_set_id | name | latest_version | created |\n` +
      `|---|---|---|---|\n`;

    const rows = sets
      .map((s) => `| ${s.id} | ${s.name} | ${s.latest_version} | ${s.created_at.slice(0, 10)} |`)
      .join("\n");

    return { content: [{ type: "text", text: header + rows }] };
  } catch (err) {
    if (err instanceof EdgeGateError) return surfaceEvalError(err);
    throw err;
  }
}
