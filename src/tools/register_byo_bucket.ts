import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ByoGrant } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const registerByoBucketInputSchema = z.object({
  workspace_id: z.string().uuid(),
  role_arn: z
    .string()
    .regex(/^arn:aws:iam::\d{12}:role\/.+$/)
    .describe(
      "ARN of the IAM role EdgeGate's workers will assume to read your bucket. " +
        "Created by the EdgeGate CloudFormation launch stack (or your equivalent " +
        "Terraform module). Format: arn:aws:iam::<account-id>:role/<name>.",
    ),
  bucket: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9][a-z0-9\-.]{1,253}$/)
    .describe("S3 bucket name (not the URI — just the bucket name)."),
  region: z
    .string()
    .min(4)
    .max(64)
    .describe("AWS region the bucket lives in, e.g. us-east-1."),
  kms_key_id: z
    .string()
    .max(2048)
    .optional()
    .describe(
      "Optional KMS key ARN if the bucket uses SSE-KMS. The IAM role must " +
        "have kms:Decrypt on this key.",
    ),
});

export type RegisterByoBucketInput = z.infer<typeof registerByoBucketInputSchema>;

export async function registerByoBucketHandler(
  client: EdgeGateClient,
  input: RegisterByoBucketInput,
): Promise<ToolResult> {
  try {
    const grant = await client.registerByoGrant(input.workspace_id, {
      role_arn: input.role_arn,
      bucket: input.bucket,
      region: input.region,
      kms_key_id: input.kms_key_id,
    });
    return successText(grant);
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 402) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: [
                `BYO storage requires the **Enterprise plan**.`,
                ``,
                `Reach out to sales at https://edgegate.frozo.ai/enterprise ` +
                  `to enable BYO storage on this workspace. ` +
                  `Once enabled, re-run \`edgegate_register_byo_bucket\` with the ` +
                  `same role + bucket details.`,
              ].join("\n"),
            },
          ],
        };
      }
      if (err.status === 409) {
        // Do NOT auto-rotate — the existing grant may belong to a different
        // role_arn the customer doesn't want overwritten by accident.
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: [
                `This workspace already has a BYO storage grant registered.`,
                ``,
                `Two safe paths forward:`,
                `1. Inspect the existing grant with \`edgegate_check_byo_bucket\` ` +
                  `to confirm it's the one you intended.`,
                `2. If you want to replace it: \`edgegate_disconnect_byo_bucket\` ` +
                  `first (will 409 if artifacts still reference it), then re-run ` +
                  `\`edgegate_register_byo_bucket\` with the new role/bucket.`,
                ``,
                `External-ID rotation (without replacing the grant) is available ` +
                  `via the dashboard at ` +
                  `https://edgegate.frozo.ai/workspace/${input.workspace_id}/settings#byo-storage.`,
              ].join("\n"),
            },
          ],
        };
      }
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}

function roleArnTail(roleArn: string): string {
  // arn:aws:iam::123456789012:role/edgegate-byo-storage-prod
  // Render the trailing role name + last 4 of the account id so the user can
  // confirm at a glance that they registered the right role.
  const parts = roleArn.split(":");
  if (parts.length < 6) return roleArn;
  const account = parts[4];
  const roleName = parts.slice(5).join(":").replace(/^role\//, "");
  const acctTail = account.length > 4 ? `…${account.slice(-4)}` : account;
  return `${roleName} (acct ${acctTail})`;
}

function successText(grant: ByoGrant): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: [
          `Registered BYO storage grant for this workspace.`,
          ``,
          `- role: \`${roleArnTail(grant.role_arn)}\``,
          `- bucket: \`${grant.bucket}\` (${grant.region})`,
          grant.kms_key_id
            ? `- kms key: \`${grant.kms_key_id}\``
            : `- kms key: (none — SSE-S3 or no encryption)`,
          `- status: **${grant.status}**`,
          `- external_id: \`${grant.external_id}\``,
          ``,
          `**Action required if you haven't already:** add this External ID to ` +
            `your IAM role's trust policy under \`Condition.StringEquals.sts:ExternalId\`. ` +
            `Without it, AssumeRole will fail with BYO_ASSUME_ROLE_FAILED.`,
          ``,
          grant.status === "active"
            ? `The readiness probe just passed. You can register your first artifact ` +
              `with \`edgegate_register_byo_artifact\`.`
            : grant.last_verify_error
              ? `The readiness probe FAILED: \`${grant.last_verify_error}\`. Fix the ` +
                `IAM/bucket/KMS configuration, then re-probe with ` +
                `\`edgegate_check_byo_bucket\`.`
              : `Probe outcome pending — run \`edgegate_check_byo_bucket\` to verify.`,
        ].join("\n"),
      },
    ],
  };
}
