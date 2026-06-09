/**
 * edgegate_attach_byo_role — Phase 2 of edgegate_setup_byo_storage.
 *
 * Pairs with `edgegate_setup_byo_storage`: that tool creates a pending
 * grant and returns AWS CLI commands the agent runs to create the IAM
 * role. This tool takes the resulting Role ARN, hands it to EdgeGate,
 * and surfaces the readiness-probe outcome.
 *
 * Why a separate tool: keeps each tool's responsibility small and lets
 * the agent recover from probe failures by re-running just this tool
 * after fixing the IAM config (instead of re-creating the grant from
 * scratch).
 */

import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ByoGrant } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const attachByoRoleInputSchema = z.object({
  workspace_id: z.string().uuid(),
  role_arn: z
    .string()
    .regex(/^arn:aws:iam::\d{12}:role\/.+$/)
    .describe(
      "ARN of the IAM role created in step 3 of edgegate_setup_byo_storage. " +
        "Format: arn:aws:iam::<account-id>:role/<name>. EdgeGate will sts:AssumeRole " +
        "this immediately to verify the trust + permission policies are correct.",
    ),
});

export type AttachByoRoleInput = z.infer<typeof attachByoRoleInputSchema>;

export async function attachByoRoleHandler(
  client: EdgeGateClient,
  input: AttachByoRoleInput,
): Promise<ToolResult> {
  try {
    const grant = await client.attachByoRole(input.workspace_id, input.role_arn);
    return resultText(grant);
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 404) {
        return errorText(
          "No pending BYO grant for this workspace. Call edgegate_setup_byo_storage first to create one.",
        );
      }
      if (err.status === 409) {
        return errorText(
          `Grant cannot accept a role right now: ${err.detail}. If the grant is already active, no further action is needed. If it's revoked, disconnect first.`,
        );
      }
      return errorText(`EdgeGate returned ${err.status}: ${err.detail}`);
    }
    throw err;
  }
}

function resultText(grant: ByoGrant): ToolResult {
  if (grant.status === "active") {
    return {
      content: [
        {
          type: "text",
          text: [
            `BYO storage **active** for bucket \`s3://${grant.bucket}\`.`,
            ``,
            `- role: \`${grant.role_arn}\``,
            `- external_id: \`${grant.external_id}\``,
            grant.kms_key_id ? `- kms key: \`${grant.kms_key_id}\`` : `- kms key: (none)`,
            `- verified: \`${grant.last_verified_at ?? "just now"}\``,
            ``,
            `Pipelines can now reference s3:// URIs in this bucket via \`edgegate_register_byo_artifact\`.`,
          ].join("\n"),
        },
      ],
    };
  }
  // status='failed' is recoverable — role_arn is persisted, customer can fix
  // IAM and re-call this tool to retry the probe.
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: [
          `BYO storage readiness probe **failed**.`,
          ``,
          `- role: \`${grant.role_arn ?? "(not attached)"}\``,
          `- last error: \`${grant.last_verify_error ?? "unknown"}\``,
          ``,
          `Common causes:`,
          `- Trust policy is missing the External ID Condition or has the wrong value.`,
          `- Permission policy doesn't grant s3:GetObject + s3:HeadObject on \`arn:aws:s3:::${grant.bucket}/*\`.`,
          grant.kms_key_id
            ? `- Missing kms:Decrypt grant on \`${grant.kms_key_id}\`.`
            : `- Bucket is encrypted but no kms_key_id was provided to edgegate_setup_byo_storage.`,
          `- IAM eventual consistency — wait 10s and re-call this tool with the same role_arn.`,
          ``,
          `Re-call this tool with the same role_arn after fixing the underlying issue.`,
        ].join("\n"),
      },
    ],
  };
}

function errorText(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
