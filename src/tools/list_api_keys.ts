import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import type { APIKeyListItem } from "../types.js";

export const listApiKeysInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type ListApiKeysInput = z.infer<typeof listApiKeysInputSchema>;

export async function listApiKeysHandler(
  client: EdgeGateClient,
  input: ListApiKeysInput,
): Promise<ToolResult> {
  try {
    const keys = await client.listApiKeys(input.workspace_id);
    if (keys.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No API keys in this workspace yet. Create one with `edgegate_create_api_key`.",
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: formatTable(keys) }],
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

function formatTable(keys: APIKeyListItem[]): string {
  const lines: string[] = [
    `Found ${keys.length} API key${keys.length === 1 ? "" : "s"} in this workspace:`,
    ``,
    `| name | id | prefix...suffix | status | last used |`,
    `|---|---|---|---|---|`,
  ];
  for (const k of keys) {
    const status = k.revoked_at
      ? "revoked"
      : k.expires_at && new Date(k.expires_at) < new Date()
        ? "expired"
        : "active";
    lines.push(
      `| ${k.name} | \`${k.id}\` | \`${k.prefix}...${k.suffix}\` | ${status} | ${k.last_used_at ?? "never"} |`,
    );
  }
  lines.push(
    ``,
    `Revoke a key with \`edgegate_revoke_api_key({ workspace_id, key_id })\`. The plaintext is never recoverable — if it was lost, rotate by creating a new key and revoking the old.`,
  );
  return lines.join("\n");
}
