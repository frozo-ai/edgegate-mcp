import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Re-run an existing behavioral-gate run: clones its already-validated config
 * (same bundle + eval set + reference + system prompt + device) into a fresh
 * QUEUED run for the self-hosted runner to pick up. No need to re-supply ids.
 */
export const rerunBgInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    run_id: z
      .string()
      .uuid()
      .describe("An existing behavioral-gate run to re-run (same config, fresh run)."),
  })
  .strict();

export type RerunBgInput = z.infer<typeof rerunBgInputSchema>;

export async function rerunBgHandler(
  client: EdgeGateClient,
  input: RerunBgInput
): Promise<ToolResult> {
  try {
    const run = await client.rerunBg(input.workspace_id, input.run_id);
    return {
      content: [
        {
          type: "text",
          text: [
            `Re-ran the behavioral-gate run as a new run:`,
            ``,
            `- run_id: ${run.run_id}`,
            `- status: ${run.status}`,
            ``,
            `Point the self-hosted runner at this new run to execute the gate on-device ` +
              `(\`edgegate-runner run --run-id ${run.run_id} --adb-serial <serial>\`).`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 404
                ? "Unknown run or workspace — re-check the ids."
                : err.status === 422
                  ? "That run is not a behavioral-gate run, so it can't be re-run here."
                  : err.status === 409
                    ? "The workspace already has an active run. Wait for it to finish, or cancel " +
                      "it with edgegate_cancel_run, then retry."
                    : err.status === 403
                      ? "You need admin access on this workspace to re-run."
                      : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
