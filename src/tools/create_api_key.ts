import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const createApiKeyInputSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(255)
    .describe(
      "Human-readable label for the key, e.g. \"GitHub Actions production\" — " +
        "you'll need this later to identify which key to rotate or revoke.",
    ),
  expires_at: z
    .string()
    .datetime()
    .optional()
    .describe(
      "Optional ISO-8601 expiry timestamp. Omit for a non-expiring key " +
        "(you can always revoke it manually).",
    ),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;

export async function createApiKeyHandler(
  client: EdgeGateClient,
  input: CreateApiKeyInput,
): Promise<ToolResult> {
  try {
    const key = await client.createApiKey(input.workspace_id, {
      name: input.name,
      expires_at: input.expires_at ?? null,
    });

    // Plaintext is shown ONCE and never again. Flag that explicitly so the
    // user knows to copy it now — and so the LLM client can be careful with
    // how/where it persists this in chat scrollback.
    return {
      content: [
        {
          type: "text",
          text: [
            `Created API key **${key.name}**.`,
            ``,
            `**Copy this plaintext now — it cannot be recovered later:**`,
            ``,
            "```",
            key.plaintext,
            "```",
            ``,
            `Details:`,
            `- key_id: \`${key.id}\``,
            `- prefix...suffix: \`${key.prefix}...${key.suffix}\``,
            `- expires: ${key.expires_at ?? "never"}`,
            ``,
            `Use it as the \`EDGEGATE_API_KEY\` env var for the MCP server, or as the bearer token for direct REST calls. Revoke it any time with \`edgegate_revoke_api_key({ workspace_id, key_id: "${key.id}" })\`.`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 402) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `API key creation requires a Pro tier or above: ${err.detail}\n\n` +
                `Upgrade at https://edgegate.frozo.ai/pricing.`,
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
