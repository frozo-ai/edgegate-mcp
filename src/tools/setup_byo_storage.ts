/**
 * edgegate_setup_byo_storage — zero-friction BYO setup orchestrator.
 *
 * Why this tool exists: the dashboard wizard's CloudFormation deep link
 * silently fails when the template isn't S3-hosted (an AWS console
 * limitation), and the Guided Steps walkthrough still asks the customer to
 * click through the IAM console. An MCP-aware agent with shell access can
 * do the entire flow autonomously — this tool registers a pending grant
 * with EdgeGate (so the agent has the right External ID + EdgeGate
 * principal ARN), then returns the exact AWS CLI commands the agent should
 * run to create the role, plus a follow-up instruction to call
 * edgegate_attach_byo_role with the resulting ARN.
 *
 * Design choice: we return INSTRUCTIONS rather than executing AWS calls
 * from inside the MCP server. Two reasons:
 *   1. Transparency — the user sees every AWS command the agent runs;
 *      they can intervene if something looks off.
 *   2. Footprint — the MCP package stays small (no aws-sdk dependency).
 *      The user's local AWS CLI is already configured; we use it.
 */

import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ByoGrant, ByoSetupInfo } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const setupByoStorageInputSchema = z.object({
  workspace_id: z
    .string()
    .uuid()
    .describe("Workspace ID. Must be Enterprise-tier with BYO storage enabled."),
  bucket: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9][a-z0-9\-.]{1,253}$/)
    .describe(
      "S3 bucket name (not the URI) you want EdgeGate to read model bytes from.",
    ),
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
      "Optional KMS key ARN if the bucket uses SSE-KMS with a customer-managed key. " +
        "The IAM role will be granted kms:Decrypt on this key. " +
        "Leave unset for SSE-S3 or SSE-KMS with the AWS-managed key.",
    ),
  role_name_override: z
    .string()
    .max(64)
    .optional()
    .describe(
      "Optional override for the IAM role name. Default mirrors the CloudFormation " +
        "path: edgegate-byo-read-<first-8-chars-of-external-id>.",
    ),
});

export type SetupByoStorageInput = z.infer<typeof setupByoStorageInputSchema>;

export async function setupByoStorageHandler(
  client: EdgeGateClient,
  input: SetupByoStorageInput,
): Promise<ToolResult> {
  try {
    // 1. Fetch the EdgeGate principal ARN — fail loudly if the deployment
    //    isn't configured. Templates would contain placeholder strings
    //    that AWS would reject, so it's better to surface the operator-side
    //    misconfiguration here than create a broken role.
    const setupInfo = await client.getByoSetupInfo(input.workspace_id);
    if (setupInfo.edgegate_aws_account_id.includes("<")) {
      return errorText(
        "This EdgeGate deployment isn't fully configured for BYO storage — " +
          "BYO_EDGEGATE_AWS_ACCOUNT_ID is missing on the operator side. Setup " +
          "cannot proceed until the EdgeGate operator sets that env var. " +
          "Contact support@edgegate.ai.",
      );
    }

    // 2. Register the pending grant (no role_arn yet). If a grant already
    //    exists in pending_role, re-use it; in active/failed, instruct the
    //    customer to disconnect first (we don't auto-rotate).
    let grant: ByoGrant;
    try {
      grant = await client.registerByoPendingGrant(input.workspace_id, {
        bucket: input.bucket,
        region: input.region,
        kms_key_id: input.kms_key_id,
      });
    } catch (err) {
      if (err instanceof EdgeGateError && err.status === 409) {
        // The 409 path: either a pending_role grant exists (which we re-use
        // by GET-ing it), or an active/failed grant exists (which the
        // customer must explicitly disconnect first). The GET tells us which.
        const existing = await client.getByoGrant(input.workspace_id);
        if (existing.status === "pending_role") {
          grant = existing;
        } else {
          return errorText(
            `This workspace already has a BYO grant in status "${existing.status}". ` +
              `Setup is for new grants. Two safe paths:\n` +
              `1. If the existing grant is the one you want, call edgegate_check_byo_bucket to re-verify it.\n` +
              `2. If you want to replace it, call edgegate_disconnect_byo_bucket first (will 409 if artifacts still reference it), then re-run this tool.`,
          );
        }
      } else if (err instanceof EdgeGateError && err.status === 402) {
        return errorText(
          "BYO storage requires the Enterprise plan. Reach out to " +
            "sales@edgegate.ai to enable it on this workspace.",
        );
      } else {
        throw err;
      }
    }

    // 3. Render the trust + permission policies. We mirror the backend
    //    templates locally instead of using the server-rendered strings
    //    (which still have placeholders) so the agent gets ready-to-paste
    //    JSON.
    const principalMatch = /^arn:aws:iam::(\d{12}):(user|role)\/(.+)$/.exec(
      setupInfo.edgegate_principal_arn,
    );
    if (!principalMatch) {
      return errorText(
        `EdgeGate returned an unexpected principal ARN: ${setupInfo.edgegate_principal_arn}. ` +
          `This usually means an operator-side misconfiguration. Contact support.`,
      );
    }
    const trustPolicy = renderTrustPolicy({
      principalArn: setupInfo.edgegate_principal_arn,
      externalId: grant.external_id,
    });
    const permissionPolicy = renderPermissionPolicy({
      bucket: input.bucket,
      kmsKeyArn: input.kms_key_id,
    });

    const roleName =
      input.role_name_override ??
      `edgegate-byo-read-${grant.external_id.slice(0, 8)}`;

    return successText({
      grant,
      setupInfo,
      roleName,
      trustPolicy: JSON.stringify(trustPolicy, null, 2),
      permissionPolicy: JSON.stringify(permissionPolicy, null, 2),
    });
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return errorText(`EdgeGate returned ${err.status}: ${err.detail}`);
    }
    throw err;
  }
}

interface SuccessArgs {
  grant: ByoGrant;
  setupInfo: ByoSetupInfo;
  roleName: string;
  trustPolicy: string;
  permissionPolicy: string;
}

function successText(args: SuccessArgs): ToolResult {
  // We embed the shell commands as fenced blocks so the agent can lift them
  // verbatim into its Bash tool. Naming the trust/perm files under /tmp/ is
  // intentional — they contain no secrets and are convenient to inspect if
  // the customer wants to verify before running. The grant's External ID is
  // already in the trust policy JSON; no separate secret-handling needed.
  const { grant, roleName, trustPolicy, permissionPolicy } = args;
  const trustFile = `/tmp/edgegate-trust-${grant.external_id.slice(0, 8)}.json`;
  const permFile = `/tmp/edgegate-perm-${grant.external_id.slice(0, 8)}.json`;

  return {
    content: [
      {
        type: "text",
        text: [
          `Pending BYO grant created. Now run these commands to create the IAM role in the customer's AWS account, then call \`edgegate_attach_byo_role\` with the resulting ARN.`,
          ``,
          `**Grant details (for the customer's confirmation):**`,
          `- workspace: \`${grant.workspace_id}\``,
          `- bucket: \`s3://${grant.bucket}\` (${grant.region})`,
          grant.kms_key_id ? `- kms key: \`${grant.kms_key_id}\`` : `- kms key: (none)`,
          `- external_id: \`${grant.external_id}\` (baked into the trust policy below)`,
          `- suggested role name: \`${roleName}\``,
          ``,
          `**Step 1 — verify AWS credentials and account:**`,
          "```bash",
          `aws sts get-caller-identity`,
          "```",
          ``,
          `**Step 2 — write the policy documents to /tmp:**`,
          "```bash",
          `cat > ${trustFile} <<'JSON'`,
          trustPolicy,
          `JSON`,
          ``,
          `cat > ${permFile} <<'JSON'`,
          permissionPolicy,
          `JSON`,
          "```",
          ``,
          `**Step 3 — create the role and attach the inline policy:**`,
          "```bash",
          `aws iam create-role \\`,
          `  --role-name ${roleName} \\`,
          `  --assume-role-policy-document file://${trustFile} \\`,
          `  --description "Allows EdgeGate read access to s3://${grant.bucket}" \\`,
          `  --tags Key=edgegate:workspace_id,Value=${grant.workspace_id} \\`,
          `         Key=edgegate:external_id,Value=${grant.external_id} \\`,
          `         Key=edgegate:bucket,Value=${grant.bucket}`,
          ``,
          `aws iam put-role-policy \\`,
          `  --role-name ${roleName} \\`,
          `  --policy-name EdgeGateReadModels \\`,
          `  --policy-document file://${permFile}`,
          ``,
          `# Capture the ARN for the next step:`,
          `aws iam get-role --role-name ${roleName} --query 'Role.Arn' --output text`,
          "```",
          ``,
          `**Step 4 — finalize with EdgeGate:**`,
          ``,
          `Take the Role ARN from Step 3 and call:`,
          ``,
          "```",
          `edgegate_attach_byo_role(workspace_id="${grant.workspace_id}", role_arn="<paste-arn-here>")`,
          "```",
          ``,
          `EdgeGate will run its readiness probe (sts:AssumeRole + a deny-by-default HEAD) and flip the grant to "active" on success, or "failed" with a typed error code if the role doesn't have the right trust/permission policy.`,
          ``,
          `**If Step 3 fails because the role already exists** (e.g. a previous run partially succeeded): the existing role's ARN is what you want — fetch it with the same \`aws iam get-role\` command and proceed to Step 4.`,
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

interface TrustPolicyArgs {
  principalArn: string;
  externalId: string;
}

function renderTrustPolicy(args: TrustPolicyArgs): unknown {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: args.principalArn },
        Action: "sts:AssumeRole",
        Condition: {
          StringEquals: { "sts:ExternalId": args.externalId },
        },
      },
    ],
  };
}

interface PermissionPolicyArgs {
  bucket: string;
  kmsKeyArn?: string;
}

function renderPermissionPolicy(args: PermissionPolicyArgs): unknown {
  const statements: Record<string, unknown>[] = [
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:HeadObject"],
      Resource: `arn:aws:s3:::${args.bucket}/*`,
    },
  ];
  if (args.kmsKeyArn) {
    statements.push({
      Effect: "Allow",
      Action: "kms:Decrypt",
      Resource: args.kmsKeyArn,
    });
  }
  return { Version: "2012-10-17", Statement: statements };
}
