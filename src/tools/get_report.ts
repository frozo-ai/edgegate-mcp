import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const getReportInputSchema = z.object({
  workspace_id: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type GetReportInput = z.infer<typeof getReportInputSchema>;

export async function getReportHandler(
  client: EdgeGateClient,
  input: GetReportInput
): Promise<ToolResult> {
  try {
    const runs = await client.listRuns(input.workspace_id, input.limit);
    if (runs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No runs in this workspace yet. Trigger one with `edgegate_run_gate`.",
          },
        ],
      };
    }
    const rows = runs
      .map((r) => {
        const dur =
          r.started_at && r.completed_at
            ? `${Math.round(
                (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000
              )}s`
            : "-";
        return `| ${r.id} | ${r.status} | ${r.trigger} | ${dur} | ${r.started_at ?? "-"} |`;
      })
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: [
            `Last ${runs.length} run(s):`,
            ``,
            `| run_id | status | trigger | duration | started_at |`,
            `|---|---|---|---|---|`,
            rows,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [{ type: "text", text: `EdgeGate returned ${err.status}: ${err.detail}` }],
      };
    }
    throw err;
  }
}
