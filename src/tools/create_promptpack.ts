import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

const promptpackIdRegex = /^[a-zA-Z0-9_-]{1,64}$/;
const caseIdRegex = /^[a-zA-Z0-9_-]{1,64}$/;
const semverRegex = /^\d+\.\d+\.\d+$/;

const defaultsSchema = z
  .object({
    max_new_tokens: z.number().int().min(1).max(256).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    seed: z.number().int().min(0).optional(),
  })
  .strict();

const expectedSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("exact"), text: z.string() }).strict(),
  z.object({ type: z.literal("regex"), pattern: z.string() }).strict(),
  z.object({
    type: z.literal("json_schema"),
    schema: z.record(z.unknown()),
  }).strict(),
]);

const caseSchema = z
  .object({
    case_id: z
      .string()
      .regex(caseIdRegex, "case_id must match ^[a-zA-Z0-9_-]{1,64}$"),
    name: z.string().min(1).max(255),
    prompt: z.string().min(1).max(32000),
    expected: expectedSchema.optional(),
    overrides: defaultsSchema.optional(),
  })
  .strict();

export const createPromptpackInputSchema = z
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
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    tags: z
      .array(z.string().min(1).max(64))
      .max(20)
      .optional(),
    defaults: defaultsSchema.optional(),
    cases: z
      .array(caseSchema)
      .min(1, "At least one case is required")
      .max(50, "Maximum 50 cases per promptpack"),
  })
  .strict();

export type CreatePromptpackInput = z.infer<typeof createPromptpackInputSchema>;

export async function createPromptpackHandler(
  client: EdgeGateClient,
  input: CreatePromptpackInput
): Promise<ToolResult> {
  try {
    const content = {
      promptpack_id: input.promptpack_id,
      version: input.version,
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.defaults !== undefined && { defaults: input.defaults }),
      cases: input.cases,
    };

    const pack = await client.createPromptPack(input.workspace_id, {
      promptpack_id: input.promptpack_id,
      version: input.version,
      content,
    });

    return {
      content: [
        {
          type: "text",
          text: [
            `Created promptpack **${pack.promptpack_id}@${pack.version}**`,
            ``,
            `- id: ${pack.id}`,
            `- ${pack.case_count} case(s)`,
            `- published: false (newly created — call the publish endpoint or set published=true in the dashboard to make it usable in pipelines)`,
            `- sha256: ${pack.sha256}`,
            ``,
            `Use it in a pipeline:`,
            `  edgegate_create_pipeline({`,
            `    ...,`,
            `    promptpack_id: "${pack.promptpack_id}",`,
            `    promptpack_version: "${pack.version}",`,
            `    ...`,
            `  })`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 409) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `A pack with id="${input.promptpack_id}" and version="${input.version}" already exists. ` +
                `Packs are immutable — bump the version (e.g. ${bumpPatch(input.version)}) and retry.`,
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
              text: "You need admin role on this workspace to create promptpacks.",
            },
          ],
        };
      }
      if (err.status === 400 || err.status === 422) {
        // Try to surface the issues array if present in detail
        let issuesText = err.detail;
        try {
          const parsed = JSON.parse(err.detail);
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.issues)) {
            issuesText =
              `Validation failed with ${parsed.issues.length} issue(s):\n` +
              (parsed.issues as unknown[]).map((iss) => `  - ${JSON.stringify(iss)}`).join("\n");
          } else if (parsed && typeof parsed === "object" && parsed.detail) {
            issuesText = String(parsed.detail);
          }
        } catch {
          // detail was plain text — keep as-is
        }
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `EdgeGate rejected the promptpack (${err.status}):\n\n${issuesText}`,
            },
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

/** Increment the patch segment of a semver string, e.g. "1.0.0" → "1.0.1". */
function bumpPatch(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return version;
  const patch = parseInt(parts[2], 10);
  return `${parts[0]}.${parts[1]}.${isNaN(patch) ? 1 : patch + 1}`;
}
