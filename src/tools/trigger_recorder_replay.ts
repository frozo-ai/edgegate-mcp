import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Trigger replay of pending recorded events against their certified reference
 * (a PASSED gate run for the same model) + input-matched baseline. Verdicts
 * land asynchronously; poll with edgegate_recorder_status.
 */
export const triggerRecorderReplayInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    device_id: z.string().optional().describe("Optional — only replay events from this device."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max pending events to replay this call. Default 100."),
  })
  .strict();

export type TriggerRecorderReplayInput = z.infer<typeof triggerRecorderReplayInputSchema>;

interface ReplayResponse {
  queued?: number;
  message?: string;
}

export async function triggerRecorderReplayHandler(
  client: EdgeGateClient,
  input: TriggerRecorderReplayInput
): Promise<ToolResult> {
  try {
    const res = (await client.triggerRecorderReplay(input.workspace_id, {
      device_id: input.device_id ?? null,
      limit: input.limit ?? 100,
    })) as unknown as ReplayResponse;

    const text = [
      `Replay dispatched: ${res.queued ?? 0} event(s) queued.`,
      res.message ?? "",
      ``,
      `Verdicts (passed / diverged / no_reference) land asynchronously — poll edgegate_recorder_status.`,
      `Note: meaningful passed/diverged verdicts require a PASSED gate run for the same model; otherwise events resolve to no_reference.`,
    ]
      .filter(Boolean)
      .join("\n");

    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              err.status === 404
                ? "Unknown workspace — re-check the id."
                : err.status === 403
                  ? "You need admin access on this workspace."
                  : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}
