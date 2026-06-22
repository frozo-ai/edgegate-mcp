import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Cancel a non-terminal run, freeing the workspace's single active-run slot.
 * Useful for a behavioral-gate run left queued waiting for a device that never
 * reports back (it would otherwise block new runs until the 24h watchdog).
 */
export const cancelRunInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    run_id: z
      .string()
      .uuid()
      .describe("Run to cancel. Frees the workspace's single active-run slot."),
  })
  .strict();

export type CancelRunInput = z.infer<typeof cancelRunInputSchema>;

export async function cancelRunHandler(
  client: EdgeGateClient,
  input: CancelRunInput
): Promise<ToolResult> {
  try {
    const res = await client.cancelRun(input.workspace_id, input.run_id);
    return {
      content: [
        {
          type: "text",
          text:
            `Cancelled run ${res.run_id} (status: ${res.status}). ` +
            `The workspace's active-run slot is now free — you can create or re-run another.`,
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
                : err.status === 409
                  ? "Run is already terminal (passed / failed / error) — nothing to cancel."
                  : err.status === 403
                    ? "You need admin access on this workspace to cancel runs."
                    : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
