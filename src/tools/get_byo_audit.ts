import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ByoAuditEntry, ByoAuditPage } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const getByoAuditInputSchema = z.object({
  workspace_id: z.string().uuid(),
  artifact_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter to events referencing this artifact."),
  run_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter to events from this run."),
  since: z
    .string()
    .datetime()
    .optional()
    .describe("ISO-8601 timestamp; only include events newer than this."),
  cursor: z
    .number()
    .int()
    .optional()
    .describe(
      "Opaque cursor returned by a previous call. Pass it back verbatim to " +
        "fetch the next page; omit on the first call.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Page size (1–500, default 100)."),
});

export type GetByoAuditInput = z.infer<typeof getByoAuditInputSchema>;

export async function getByoAuditHandler(
  client: EdgeGateClient,
  input: GetByoAuditInput,
): Promise<ToolResult> {
  try {
    const page = await client.getByoAudit(input.workspace_id, {
      artifact_id: input.artifact_id,
      run_id: input.run_id,
      since: input.since,
      cursor: input.cursor,
      limit: input.limit,
    });
    return renderAuditPage(page);
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

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function fmt(entry: ByoAuditEntry): string {
  const cells = [
    entry.ts,
    entry.event_type,
    entry.outcome,
    entry.error_code ?? "—",
    truncate(entry.aws_request_id, 36),
    truncate(entry.s3_key ?? "—", 48),
    entry.bytes_read?.toLocaleString() ?? "—",
    entry.run_id ? truncate(entry.run_id, 8) : "—",
  ];
  return `| ${cells.join(" | ")} |`;
}

function renderAuditPage(page: ByoAuditPage): ToolResult {
  if (page.entries.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: [
            `No BYO storage audit events match these filters.`,
            ``,
            `If you expected results, check that:`,
            `- The workspace actually has BYO storage enabled (Enterprise plan).`,
            `- The \`run_id\` / \`artifact_id\` / \`since\` filters aren't too narrow.`,
            `- A run that consumed BYO artifacts has actually executed (verify probes ` +
              `also appear here, every 6 hours).`,
          ].join("\n"),
        },
      ],
    };
  }
  const header = `| ts | event_type | outcome | error_code | aws_request_id | s3_key | bytes_read | run_id |`;
  const sep = `|---|---|---|---|---|---|---|---|`;
  const rows = page.entries.map(fmt).join("\n");
  const lines = [
    `BYO storage audit — ${page.entries.length} event(s)`,
    ``,
    header,
    sep,
    rows,
    ``,
    page.next_cursor === null
      ? `End of log.`
      : `Call again with \`cursor: ${page.next_cursor}\` to fetch the next page.`,
    ``,
    `Cross-reference \`aws_request_id\` against your own CloudTrail to confirm ` +
      `EdgeGate's view of each S3 call matches yours.`,
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
