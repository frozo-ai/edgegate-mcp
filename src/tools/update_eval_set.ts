import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import {
  evalCaseSchema,
  formatVersion,
  surfaceEvalError,
} from "./create_eval_set.js";

export const updateEvalSetInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    eval_set_id: z.string().uuid(),
    version_id: z.string().uuid(),
    cases: z
      .array(evalCaseSchema)
      .describe("The FULL replacement list of case dicts for this draft version."),
  })
  .strict();

export type UpdateEvalSetInput = z.infer<typeof updateEvalSetInputSchema>;

export async function updateEvalSetHandler(
  client: EdgeGateClient,
  input: UpdateEvalSetInput
): Promise<ToolResult> {
  try {
    const version = await client.updateEvalSet(
      input.workspace_id,
      input.eval_set_id,
      input.version_id,
      input.cases
    );

    return {
      content: [
        {
          type: "text",
          text:
            formatVersion(version, `Updated draft version (cases fully replaced):`) +
            `\n\nStill a draft — call \`edgegate_publish_eval_set\` to validate, hash, sign, and freeze it.`,
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 409) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "This version is already published and is immutable. To change a " +
                "published set, fork a fresh draft with " +
                `\`edgegate_new_eval_set_version({ workspace_id, eval_set_id, from_version: "${input.version_id}" })\`, ` +
                "edit that draft, then publish it.",
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
              text:
                "Unknown eval set or version. Check the eval_set_id / version_id " +
                "with `edgegate_list_eval_sets`.",
            },
          ],
        };
      }
      return surfaceEvalError(err);
    }
    throw err;
  }
}
