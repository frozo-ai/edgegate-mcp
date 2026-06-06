import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const disconnectByoBucketInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type DisconnectByoBucketInput = z.infer<typeof disconnectByoBucketInputSchema>;

export async function disconnectByoBucketHandler(
  client: EdgeGateClient,
  input: DisconnectByoBucketInput,
): Promise<ToolResult> {
  try {
    await client.deleteByoGrant(input.workspace_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Removed the BYO storage grant for this workspace.`,
            ``,
            `EdgeGate will no longer attempt to AssumeRole into your AWS account. ` +
              `New artifact registrations via \`edgegate_register_byo_artifact\` will ` +
              `fail until a fresh grant is registered.`,
            ``,
            `Existing artifacts that pointed at the bucket are also invalidated — any ` +
              `attempt to read them during a run will surface BYO_NO_GRANT. If you want ` +
              `to keep using the same bucket, re-register with ` +
              `\`edgegate_register_byo_bucket\` and the artifacts will be re-resolvable.`,
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
                `BYO storage requires the Enterprise plan. ` +
                `Contact sales: https://edgegate.frozo.ai/enterprise.`,
            },
          ],
        };
      }
      if (err.status === 404) {
        return {
          content: [
            {
              type: "text",
              text: `No BYO storage grant is registered for this workspace — nothing to disconnect.`,
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
              text: [
                `Cannot disconnect — artifacts still reference this BYO grant.`,
                ``,
                `EdgeGate refuses to orphan artifact rows whose \`storage_url\` ` +
                  `points at your bucket. Two safe paths forward:`,
                ``,
                `1. **Keep the artifacts.** Leave the grant in place. If you only ` +
                  `wanted to rotate the External ID, use the dashboard ` +
                  `(\`https://edgegate.frozo.ai/workspace/${input.workspace_id}/settings#byo-storage\`) ` +
                  `to rotate without deleting.`,
                `2. **Drop the artifacts first.** Use the dashboard's artifact list to ` +
                  `delete each BYO artifact, then re-run ` +
                  `\`edgegate_disconnect_byo_bucket\`. Runs that referenced the deleted ` +
                  `artifacts will keep their evidence bundles — only the pointer is gone.`,
                ``,
                `Detail from EdgeGate: \`${err.detail}\``,
              ].join("\n"),
            },
          ],
        };
      }
      return {
        isError: true,
        content: [
          { type: "text", text: `EdgeGate returned ${err.status}: ${err.detail}` },
        ],
      };
    }
    throw err;
  }
}
