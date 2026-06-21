import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import { formatVersion, surfaceEvalError } from "./create_eval_set.js";

export const newEvalSetVersionInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    eval_set_id: z.string().uuid(),
    from_version: z
      .string()
      .uuid()
      .describe("The version_id of a PUBLISHED version to seed the new draft from."),
  })
  .strict();

export type NewEvalSetVersionInput = z.infer<typeof newEvalSetVersionInputSchema>;

export async function newEvalSetVersionHandler(
  client: EdgeGateClient,
  input: NewEvalSetVersionInput
): Promise<ToolResult> {
  try {
    const version = await client.newEvalSetVersion(
      input.workspace_id,
      input.eval_set_id,
      input.from_version
    );

    return {
      content: [
        {
          type: "text",
          text:
            formatVersion(
              version,
              `Forked a new draft version seeded from the published cases:`
            ) +
            `\n\nEdit it with \`edgegate_update_eval_set\`, then \`edgegate_publish_eval_set\` to re-publish. ` +
            `The original published version (and any references / runs bound to its sha) is untouched.`,
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
                `Unknown eval set or from_version="${input.from_version}". ` +
                `Check the ids with \`edgegate_list_eval_sets\`.`,
            },
          ],
        };
      }
      return surfaceEvalError(err);
    }
    throw err;
  }
}
