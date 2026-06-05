import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

const promptpackIdRegex = /^[a-zA-Z0-9_-]{1,64}$/;
const semverRegex = /^\d+\.\d+\.\d+$/;

export const publishPromptpackInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    promptpack_id: z
      .string()
      .regex(
        promptpackIdRegex,
        "promptpack_id must match ^[a-zA-Z0-9_-]{1,64}$"
      ),
    version: z
      .string()
      .regex(semverRegex, "version must be semver (e.g. 1.0.0)"),
  })
  .strict();

export type PublishPromptpackInput = z.infer<typeof publishPromptpackInputSchema>;

export async function publishPromptpackHandler(
  client: EdgeGateClient,
  input: PublishPromptpackInput
): Promise<ToolResult> {
  try {
    const pack = await client.publishPromptPack(
      input.workspace_id,
      input.promptpack_id,
      input.version
    );

    return {
      content: [
        {
          type: "text",
          text: [
            `Published **${pack.promptpack_id}@${pack.version}**`,
            ``,
            `- id: ${pack.id}`,
            `- ${pack.case_count} case(s)`,
            `- published: ${pack.published}`,
            `- sha256: ${pack.sha256}`,
            ``,
            `The pack is now usable as \`promptpack_id\` in edgegate_create_pipeline.`,
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
              text:
                `Promptpack ${input.promptpack_id}@${input.version} not found in this workspace. ` +
                `List your packs with edgegate_list_promptpacks.`,
            },
          ],
        };
      }
      if (err.status === 403) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "You need admin role on this workspace to publish promptpacks.",
            },
          ],
        };
      }
      // 409 or any response indicating "already published" — treat as idempotent success
      if (err.status === 409) {
        const lowerDetail = err.detail.toLowerCase();
        if (lowerDetail.includes("already published") || lowerDetail.includes("already")) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `**${input.promptpack_id}@${input.version}** is already published (idempotent).`,
                  ``,
                  `The pack is usable as \`promptpack_id\` in edgegate_create_pipeline.`,
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
      if (err.status === 401) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "EDGEGATE_API_KEY is missing, expired, or revoked. Generate a fresh key at " +
                "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys and retry.",
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
