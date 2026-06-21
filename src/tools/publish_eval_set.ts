import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";
import { formatVersion, surfaceEvalError } from "./create_eval_set.js";

export const publishEvalSetInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    eval_set_id: z.string().uuid(),
    version_id: z.string().uuid(),
  })
  .strict();

export type PublishEvalSetInput = z.infer<typeof publishEvalSetInputSchema>;

export async function publishEvalSetHandler(
  client: EdgeGateClient,
  input: PublishEvalSetInput
): Promise<ToolResult> {
  try {
    const version = await client.publishEvalSet(
      input.workspace_id,
      input.eval_set_id,
      input.version_id
    );

    const next =
      `\n\nFeed \`artifact_id\` and \`eval_set_sha256\` into a Behavioral-Gate run ` +
      `(3b create-bg-run) as the eval-set inputs. The runner recomputes the sha after ` +
      `download and confirms it matches.`;

    return {
      content: [
        {
          type: "text",
          text:
            formatVersion(
              version,
              `Published eval set version — validated, hashed, signed, and frozen:`
            ) + next,
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      if (err.status === 422) {
        const violations = extractViolations(err.detail);
        const body =
          violations.length > 0
            ? `Validation failed with ${violations.length} violation(s) — the version stays a draft:\n` +
              violations.map((v) => `  - ${v}`).join("\n")
            : `Validation failed (422) — the version stays a draft:\n${err.detail}`;
        return { isError: true, content: [{ type: "text", text: body }] };
      }
      if (err.status === 404) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Unknown eval set or version. Check the eval_set_id / version_id " +
                "with `edgegate_list_eval_sets`.",
            },
          ],
        };
      }
      return surfaceEvalError(err);
    }
    throw err;
  }
}

/**
 * Pull the `violations` array out of a 422 `detail`. The backend returns
 * `422 {detail: {violations: [...]}}`; the client stringifies `detail`, so
 * `err.detail` is the JSON-stringified `{violations: [...]}` object (or a
 * plain string fallback).
 */
function extractViolations(detail: string): string[] {
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "violations" in parsed &&
      Array.isArray((parsed as { violations: unknown }).violations)
    ) {
      return (parsed as { violations: unknown[] }).violations.map((v) => String(v));
    }
  } catch {
    // detail was plain text — fall through
  }
  return [];
}
