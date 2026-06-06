import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const revokeApiKeyInputSchema = z.object({
  workspace_id: z.string().uuid(),
  key_id: z
    .string()
    .uuid()
    .describe(
      "UUID of the key to revoke (the `id` field from `edgegate_list_api_keys`). " +
        "This is destructive and immediate — any CI job or client still using " +
        "the plaintext will fail authentication on the next request.",
    ),
});

export type RevokeApiKeyInput = z.infer<typeof revokeApiKeyInputSchema>;

export async function revokeApiKeyHandler(
  client: EdgeGateClient,
  input: RevokeApiKeyInput,
): Promise<ToolResult> {
  try {
    await client.revokeApiKey(input.workspace_id, input.key_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Revoked API key \`${input.key_id}\`.`,
            ``,
            `The key is now rejected for all future requests. The audit trail (last_used_at, revoked_at) is preserved on the row — you can still see it in \`edgegate_list_api_keys\`.`,
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
              text: `API key \`${input.key_id}\` not found in this workspace (or already revoked).`,
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
