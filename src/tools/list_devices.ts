import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { DeviceEntry, DeviceListResponse } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Lists every Qualcomm AI Hub device EdgeGate can target.
 *
 * No workspace_id required — the device catalog is global, not customer-
 * scoped. Optional `category` filter narrows to a single form-factor when
 * the caller already knows what they're targeting (e.g. "iot" for Bosch).
 *
 * Output is grouped by category and renders as a markdown table so the
 * model can pull device IDs verbatim when constructing a create_pipeline
 * call.
 */
export const listDevicesInputSchema = z.object({
  category: z
    .enum(["smartphone", "reference", "compute", "iot", "automotive", "xr"])
    .optional()
    .describe(
      "Optional form-factor filter. Omit to return the full catalog grouped by category."
    ),
});

export type ListDevicesInput = z.infer<typeof listDevicesInputSchema>;

export async function listDevicesHandler(
  client: EdgeGateClient,
  input: ListDevicesInput
): Promise<ToolResult> {
  try {
    const resp = await client.listDevices();
    const filtered = input.category
      ? resp.devices.filter((d) => d.category === input.category)
      : resp.devices;

    if (filtered.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: input.category
              ? `No devices in category "${input.category}". Try omitting the filter to see all ${resp.total} devices.`
              : "No devices configured. This is almost certainly a backend misconfiguration — file a bug.",
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: render(filtered, resp.total, input.category) }],
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

function render(devices: DeviceEntry[], totalAll: number, filter?: string): string {
  const lines: string[] = [];
  if (filter) {
    lines.push(`# AI Hub devices · category=${filter} (${devices.length} of ${totalAll})`);
  } else {
    lines.push(`# AI Hub devices (${devices.length} total)`);
  }
  lines.push("");

  // Group by category for the unfiltered case so callers can scan.
  const byCategory = new Map<string, DeviceEntry[]>();
  for (const d of devices) {
    const arr = byCategory.get(d.category) ?? [];
    arr.push(d);
    byCategory.set(d.category, arr);
  }
  for (const [category, items] of byCategory) {
    lines.push(`## ${category}`);
    lines.push("");
    lines.push("| id | name |");
    lines.push("|---|---|");
    for (const d of items) {
      lines.push(`| \`${d.id}\` | ${d.name} |`);
    }
    lines.push("");
  }

  lines.push(
    "Use the `id` column when constructing `create_pipeline` calls. The `name` column is the canonical AI Hub label."
  );
  return lines.join("\n");
}

// Re-export so server.ts doesn't have to import the type from two places.
export type { DeviceListResponse };
