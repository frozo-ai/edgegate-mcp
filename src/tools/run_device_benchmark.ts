import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Dispatch a benchmark to a customer-connected device (Jetson, gateway,
 * Snapdragon host). The on-device agent picks the job up on its next poll
 * (~30s), runs the ONNX model, and reports results — visible on the devices
 * page and via edgegate_list_device_targets.
 */
export const runDeviceBenchmarkInputSchema = z.object({
  workspace_id: z.string().uuid(),
  device: z
    .string()
    .describe(
      "Device to run on: DB UUID, agent device_id, or the exact display name " +
        "from edgegate_list_device_targets."
    ),
  model_artifact_id: z.string().uuid().describe("ONNX model artifact in this workspace."),
  model_name: z.string().optional().describe("Label for the result; defaults to the artifact filename."),
});

export type RunDeviceBenchmarkInput = z.infer<typeof runDeviceBenchmarkInputSchema>;

export async function runDeviceBenchmarkHandler(
  client: EdgeGateClient,
  input: RunDeviceBenchmarkInput
): Promise<ToolResult> {
  try {
    let deviceRef = input.device;
    // Friendly-name resolution: if it's not a UUID, try matching a target name.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceRef)) {
      const targets = await client.listDeviceTargets(input.workspace_id);
      const byName = targets.find((t) => t.name === deviceRef);
      if (byName) deviceRef = byName.id;
    }

    const job = await client.createDeviceBenchmarkJob(input.workspace_id, deviceRef, {
      model_artifact_id: input.model_artifact_id,
      model_name: input.model_name,
    });

    return {
      content: [
        {
          type: "text",
          text:
            `Benchmark job \`${job.id}\` queued for device \`${input.device}\` ` +
            `(model: ${job.model_name}). The agent picks it up within ~30s; results ` +
            `appear on the devices page and in edgegate_list_device_targets/compare.`,
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
