import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import { surfaceEvalError } from "./create_eval_set.js";

export const listEvalPacksInputSchema = z.object({}).strict();

export type ListEvalPacksInput = z.infer<typeof listEvalPacksInputSchema>;

export async function listEvalPacksHandler(
  client: EdgeGateClient,
  _input: ListEvalPacksInput
): Promise<ToolResult> {
  try {
    const packs = await client.listEvalPacks();

    if (packs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              "No bundled eval packs available. You can still create an eval set " +
              "from scratch with `edgegate_create_eval_set` (pass explicit cases).",
          },
        ],
      };
    }

    const header =
      `Found ${packs.length} bundled eval pack(s) you can clone from:\n\n` +
      `| id | name | cases | must_refuse(+forbidden) | task |\n` +
      `|---|---|---|---|---|\n`;

    const rows = packs
      .map((p) => {
        const b = p.balance;
        return `| ${p.id} | ${p.name} | ${p.case_count} | ${b.must_refuse} (${b.must_refuse_with_forbidden}) | ${b.task} |`;
      })
      .join("\n");

    const footer =
      `\n\nClone one into a new eval set with ` +
      `\`edgegate_create_eval_set({ workspace_id, name, clone_from: "<id>" })\`.`;

    return { content: [{ type: "text", text: header + rows + footer }] };
  } catch (err) {
    if (err instanceof EdgeGateError) return surfaceEvalError(err);
    throw err;
  }
}
