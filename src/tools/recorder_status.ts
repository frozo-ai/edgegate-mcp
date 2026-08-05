import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Field Recorder status: recorded-event counts, replay/divergence breakdown,
 * hash-chain integrity, and the devices reporting in. Read-only.
 */
export const recorderStatusInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    device_id: z.string().optional().describe("Optional — scope the status to a single device."),
  })
  .strict();

export type RecorderStatusInput = z.infer<typeof recorderStatusInputSchema>;

interface DivergenceType {
  type?: string;
  count?: number;
  description?: string;
}
interface ChainStatus {
  verified?: boolean;
  event_count?: number;
  has_gaps?: boolean;
  last_hash?: string;
  signing_keys?: string[];
}
interface RecorderSummary {
  total_events?: number;
  replayed?: number;
  passed?: number;
  diverged?: number;
  no_reference?: number;
  pending?: number;
  divergence_rate?: number;
  divergence_types?: DivergenceType[];
  devices?: string[];
  chain_status?: ChainStatus;
}

export async function recorderStatusHandler(
  client: EdgeGateClient,
  input: RecorderStatusInput
): Promise<ToolResult> {
  try {
    const s = (await client.getRecorderSummary(
      input.workspace_id,
      input.device_id
    )) as unknown as RecorderSummary;

    const cs = s.chain_status ?? {};
    const divLines = (s.divergence_types ?? []).map(
      (d) => `  - ${d.type}: ${d.count} — ${d.description ?? ""}`
    );

    const text = [
      `## Field Recorder status`,
      `Events: ${s.total_events ?? 0}  ·  replayed ${s.replayed ?? 0}  ·  pending ${s.pending ?? 0}`,
      `Replay verdicts: passed ${s.passed ?? 0} · diverged ${s.diverged ?? 0} · no_reference ${s.no_reference ?? 0} (divergence rate ${s.divergence_rate ?? 0}%)`,
      ``,
      `### Chain integrity`,
      `- Verified: ${cs.verified ? "yes" : "no"}${cs.has_gaps ? " (gaps detected)" : ""}`,
      `- Events in chain: ${cs.event_count ?? 0}`,
      `- Last hash: ${cs.last_hash ? cs.last_hash.slice(0, 16) + "…" : "—"}`,
      `- Signing keys: ${(cs.signing_keys ?? []).join(", ") || "—"}`,
      ``,
      `### Devices`,
      `${(s.devices ?? []).join(", ") || "(none)"}`,
      ...(divLines.length ? ["", "### Divergence types", ...divLines] : []),
    ].join("\n");

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
