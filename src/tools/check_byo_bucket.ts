import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ByoGrant } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const checkByoBucketInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type CheckByoBucketInput = z.infer<typeof checkByoBucketInputSchema>;

export async function checkByoBucketHandler(
  client: EdgeGateClient,
  input: CheckByoBucketInput,
): Promise<ToolResult> {
  try {
    const grant = await client.verifyByoGrant(input.workspace_id);
    return renderGrantStatus(grant);
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
              text: [
                `No BYO storage grant is registered for this workspace.`,
                ``,
                `Register one with \`edgegate_register_byo_bucket\` first. ` +
                  `Until then, this workspace uses EdgeGate-managed storage.`,
              ].join("\n"),
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

function renderGrantStatus(grant: ByoGrant): ToolResult {
  const lines: string[] = [
    `BYO storage probe result: **${grant.status}**`,
    ``,
    `- bucket: \`${grant.bucket}\` (${grant.region})`,
    `- role: \`${grant.role_arn}\``,
    grant.kms_key_id
      ? `- kms key: \`${grant.kms_key_id}\``
      : `- kms key: (none)`,
    `- last_verified_at: ${grant.last_verified_at ?? "(never)"}`,
  ];
  if (grant.status === "active") {
    lines.push(``);
    lines.push(
      `Probe passed — AssumeRole + HeadObject succeeded. You can register ` +
        `artifacts with \`edgegate_register_byo_artifact\` and trigger runs as usual.`,
    );
  } else if (grant.status === "failed" && grant.last_verify_error) {
    lines.push(``);
    lines.push(`Last error: \`${grant.last_verify_error}\``);
    lines.push(``);
    lines.push(`Common causes:`);
    lines.push(
      `- **BYO_ASSUME_ROLE_FAILED** — the External ID in your role's trust policy ` +
        `doesn't match. Copy the \`external_id\` from \`edgegate_register_byo_bucket\` ` +
        `or the dashboard into your trust policy's \`sts:ExternalId\` condition.`,
    );
    lines.push(
      `- **BYO_OBJECT_ACCESS_DENIED** / **BYO_BUCKET_GONE** — the IAM role lacks ` +
        `s3:GetObject/ListBucket on the registered bucket, or the bucket name was ` +
        `mistyped.`,
    );
    lines.push(
      `- **BYO_KMS_ACCESS_DENIED** — bucket uses SSE-KMS but the role lacks ` +
        `kms:Decrypt on the key.`,
    );
    lines.push(
      `- **BYO_REGION_MISMATCH** — the bucket isn't in the region you registered.`,
    );
    lines.push(``);
    lines.push(
      `Fix the IAM/bucket config in your AWS account, then re-run ` +
        `\`edgegate_check_byo_bucket\` to re-probe.`,
    );
  } else if (grant.status === "revoked") {
    lines.push(``);
    lines.push(
      `The grant is revoked — no further reads will be attempted. Register a fresh ` +
        `grant via \`edgegate_register_byo_bucket\` if you want to re-enable BYO storage.`,
    );
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
