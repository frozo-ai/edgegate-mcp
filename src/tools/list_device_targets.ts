import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { DeviceTarget } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Lists the customer's own connected devices (Jetson, Snapdragon hosts,
 * gateways) with a live/offline status computed server-side from each
 * device's heartbeat (30s beat, 90s liveness window).
 *
 * Workspace-scoped — this is the fleet the customer connected via
 * `edgegate-runner agent` or the standalone edgegate-agent, NOT the global
 * AI Hub catalog (that's `edgegate_list_devices`).
 */
export const listDeviceTargetsInputSchema = z.object({
  workspace_id: z.string().uuid(),
});

export type ListDeviceTargetsInput = z.infer<typeof listDeviceTargetsInputSchema>;

export async function listDeviceTargetsHandler(
  client: EdgeGateClient,
  input: ListDeviceTargetsInput
): Promise<ToolResult> {
  try {
    const targets = await client.listDeviceTargets(input.workspace_id);

    if (targets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: [
              "No device targets connected yet. Connect one in 60 seconds:",
              "",
              "```bash",
              "pip install edgegate-runner",
              "export EDGEGATE_TOKEN=egk_...   # create via edgegate_create_api_key",
              `export EDGEGATE_WORKSPACE_ID=${input.workspace_id}`,
              "edgegate-runner agent --vendor nvidia --name my-device",
              "```",
              "",
              "The device appears here (and on the dashboard's Device Targets section) within seconds.",
            ].join("\n"),
          },
        ],
      };
    }

    return { content: [{ type: "text", text: render(targets) }] };
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

function render(targets: DeviceTarget[]): string {
  const live = targets.filter((t) => t.status === "online").length;
  const lines: string[] = [];
  lines.push(`# Device targets (${live} of ${targets.length} live)`);
  lines.push("");
  lines.push("| status | name | vendor | chip | runtime | last seen |");
  lines.push("|---|---|---|---|---|---|");
  for (const t of targets) {
    const badge = t.status === "online" ? "🟢 live" : "⚪ offline";
    lines.push(
      `| ${badge} | ${t.name} | ${t.chip_vendor ?? "—"} | ${t.chip ?? "—"} | ${
        t.runtime ?? "—"
      } | ${t.last_seen_at ?? "never"} |`
    );
  }
  lines.push("");
  lines.push(
    "Status is computed from each device's heartbeat (live = beat within the last 90s). " +
      "Offline means the agent on that box stopped or lost connectivity."
  );
  return lines.join("\n");
}
