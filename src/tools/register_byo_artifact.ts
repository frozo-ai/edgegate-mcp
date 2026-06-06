import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ArtifactResponse } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const registerByoArtifactInputSchema = z.object({
  workspace_id: z.string().uuid(),
  s3_uri: z
    .string()
    .regex(/^s3:\/\/[a-z0-9][a-z0-9\-.]{1,253}\/.+$/)
    .describe(
      "Full S3 URI of the object in your registered bucket, e.g. " +
        "s3://my-bucket/models/mobilenet-v2.onnx. Must live in the same " +
        "bucket the grant was registered with.",
    ),
  expected_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .describe(
      "Optional SHA-256 of the object (hex). If supplied, downstream cells " +
        "will fail with BYO_INTEGRITY_MISMATCH when the actual bytes don't " +
        "match — a strong guarantee that you ran what you thought you ran.",
    ),
  expected_size: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional size in bytes. EdgeGate cross-checks against the HeadObject " +
        "response and rejects the registration if they disagree — protects " +
        "against stale pointers when an object was overwritten in S3.",
    ),
  kind: z
    .string()
    .optional()
    .describe("Artifact kind. Defaults to 'model'."),
  original_filename: z
    .string()
    .optional()
    .describe("Optional display filename for run reports."),
});

export type RegisterByoArtifactInput = z.infer<typeof registerByoArtifactInputSchema>;

export async function registerByoArtifactHandler(
  client: EdgeGateClient,
  input: RegisterByoArtifactInput,
): Promise<ToolResult> {
  try {
    const artifact = await client.registerByoArtifact(input.workspace_id, {
      s3_uri: input.s3_uri,
      expected_sha256: input.expected_sha256,
      expected_size: input.expected_size,
      kind: input.kind,
      original_filename: input.original_filename,
    });
    return renderArtifact(artifact);
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
      if (err.status === 400) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: [
                `EdgeGate rejected the BYO artifact registration:`,
                ``,
                `\`${err.detail}\``,
                ``,
                `Most common causes:`,
                `- **No active grant** — register one with \`edgegate_register_byo_bucket\` first.`,
                `- **Bucket mismatch** — the s3_uri's bucket is not the one this workspace ` +
                  `registered. Cross-bucket pointers are not allowed.`,
                `- **BYO_OBJECT_NOT_FOUND** — the s3_uri's key doesn't exist in the bucket. ` +
                  `Double-check the path; HeadObject is case-sensitive.`,
                `- **BYO_OBJECT_ACCESS_DENIED** — the IAM role lacks \`s3:GetObject\` ` +
                  `on this specific key (a bucket-policy or resource-condition denial).`,
                `- **Size mismatch** — the \`expected_size\` you supplied doesn't match the ` +
                  `actual object. Drop it (or update it) and retry.`,
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

function renderArtifact(artifact: ArtifactResponse): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: [
          `Registered BYO artifact — bytes never left your AWS account.`,
          ``,
          `- artifact_id: \`${artifact.id}\``,
          `- storage: \`${artifact.storage_url}\``,
          `- kind: ${artifact.kind}`,
          `- size: ${artifact.size_bytes.toLocaleString()} bytes`,
          `- sha256: \`${artifact.sha256}\``,
          artifact.original_filename
            ? `- filename: \`${artifact.original_filename}\``
            : `- filename: (none)`,
          ``,
          `Pass this \`artifact_id\` to \`edgegate_create_pipeline\` (in \`model_matrix\`) ` +
            `or \`edgegate_run_gate\` (as \`model_artifact_id\`) to run it. ` +
            `When a cell needs the model, EdgeGate's worker will AssumeRole into your ` +
            `account and GetObject directly from S3.`,
        ].join("\n"),
      },
    ],
  };
}
