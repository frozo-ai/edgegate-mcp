import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import type { EvalSetVersion } from "../types.js";

/**
 * Shared schema for one behavioral eval case — exactly the six fields from the
 * eval-set authoring contract §3, byte-faithful to edgegate/bg/eval_set.py.
 * Reused by create_eval_set and update_eval_set. Drafts are NOT validated on
 * create/update (only publish freezes + gates), so this schema only enforces
 * the shape, not the balance floor.
 */
export const evalCaseSchema = z
  .object({
    case_id: z.string().min(1, "case_id must be non-empty"),
    prompt: z.string().min(1, "prompt must be non-empty"),
    category: z.enum(["jailbreak", "forbidden_action", "task", "format"]),
    forbidden_actions: z.array(z.string()),
    must_refuse: z.boolean(),
    expected_task_answer: z.string().nullable(),
  })
  .strict();

export const createEvalSetInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    name: z.string().min(1).max(255),
    clone_from: z
      .string()
      .optional()
      .describe(
        "A pack id from edgegate_list_eval_packs; seeds the draft with that pack's cases."
      ),
    cases: z
      .array(evalCaseSchema)
      .optional()
      .describe(
        "Explicit list of case dicts. May be combined with clone_from or used " +
          "instead. Omit both to start with an empty draft."
      ),
  })
  .strict();

export type CreateEvalSetInput = z.infer<typeof createEvalSetInputSchema>;

export function formatVersion(v: EvalSetVersion, heading: string): string {
  const lines = [
    heading,
    ``,
    `- eval_set_id: ${v.eval_set_id}`,
    `- version_id: ${v.id}`,
    `- version: ${v.version}`,
    `- status: ${v.status}`,
    `- cases: ${v.cases.length}`,
  ];
  if (v.status === "published") {
    lines.push(`- eval_set_sha256: ${v.eval_set_sha256}`);
    lines.push(`- artifact_id: ${v.artifact_id}`);
    if (v.balance) {
      lines.push(
        `- balance: must_refuse=${v.balance.must_refuse}, ` +
          `must_refuse_with_forbidden=${v.balance.must_refuse_with_forbidden}, ` +
          `task=${v.balance.task}, benign=${v.balance.benign}, total=${v.balance.total}`
      );
    }
    if (v.published_at) lines.push(`- published_at: ${v.published_at}`);
  }
  return lines.join("\n");
}

export async function createEvalSetHandler(
  client: EdgeGateClient,
  input: CreateEvalSetInput
): Promise<ToolResult> {
  try {
    const body: { name: string; clone_from?: string; cases?: typeof input.cases } = {
      name: input.name,
    };
    if (input.clone_from !== undefined) body.clone_from = input.clone_from;
    if (input.cases !== undefined) body.cases = input.cases;

    const version = await client.createEvalSet(input.workspace_id, body);

    const next =
      `\nEdit cases with \`edgegate_update_eval_set\` (full replacement list), ` +
      `then \`edgegate_publish_eval_set\` to validate, hash, sign, and freeze the version.`;

    return {
      content: [
        {
          type: "text",
          text:
            formatVersion(version, `Created eval set **${input.name}** with its first draft version:`) +
            `\n${next}`,
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
                `An eval set with name="${input.name}" already exists in this workspace. ` +
                `Pick a different name, or list existing sets with \`edgegate_list_eval_sets\`.`,
            },
          ],
        };
      }
      if (err.status === 404) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `clone_from="${input.clone_from}" is not a known bundled pack. ` +
                `List the available packs with \`edgegate_list_eval_packs\`.`,
            },
          ],
        };
      }
      return surfaceEvalError(err);
    }
    throw err;
  }
}

/** Shared EdgeGateError → ToolResult formatter for the eval-set tools. */
export function surfaceEvalError(err: EdgeGateError): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          err.status === 401
            ? "EDGEGATE_API_KEY is missing, expired, or revoked. Generate a fresh key at " +
              "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys and retry."
            : err.status === 403
              ? "You need write access on this workspace to author eval sets."
              : `EdgeGate returned ${err.status}: ${err.detail}`,
      },
    ],
  };
}
