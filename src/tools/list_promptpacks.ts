import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const listPromptpacksInputSchema = z.object({
  workspace_id: z.string().uuid(),
  include_unpublished: z
    .boolean()
    .optional()
    .default(true)
    .describe("When false, hides packs with published=false (client-side filter). Default: true."),
});

export type ListPromptpacksInput = z.infer<typeof listPromptpacksInputSchema>;

export async function listPromptpacksHandler(
  client: EdgeGateClient,
  input: ListPromptpacksInput
): Promise<ToolResult> {
  try {
    const packs = await client.listPromptPacks(input.workspace_id);

    const filtered = input.include_unpublished
      ? packs
      : packs.filter((p) => p.published);

    if (filtered.length === 0) {
      const suffix = !input.include_unpublished && packs.length > 0
        ? ` (${packs.length} unpublished pack(s) hidden — set include_unpublished=true to see them)`
        : "";
      return {
        content: [
          {
            type: "text",
            text:
              `No promptpacks yet in this workspace${suffix}.\n\n` +
              `Create one with \`edgegate_create_promptpack\` or upload via the dashboard at ` +
              `https://edgegate.frozo.ai/workspace/${input.workspace_id}/promptpacks.`,
          },
        ],
      };
    }

    const header =
      `Found ${filtered.length} promptpack(s) in this workspace:\n\n` +
      `| promptpack_id | version | cases | published | created |\n` +
      `|---|---|---|---|---|\n`;

    const rows = filtered
      .map((p) => {
        const date = p.created_at.slice(0, 10);
        const pub = p.published ? "yes" : "no";
        return `| ${p.promptpack_id} | ${p.version} | ${p.case_count} | ${pub} | ${date} |`;
      })
      .join("\n");

    const footer =
      `\n\nUse the \`promptpack_id\` (string column) in \`edgegate_create_pipeline\`'s ` +
      `\`promptpack_id\` field. The \`version\` defaults to "1.0.0" but can be overridden.`;

    return {
      content: [{ type: "text", text: header + rows + footer }],
    };
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
