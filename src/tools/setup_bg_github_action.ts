import { z } from "zod";
import { EdgeGateClient } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

/**
 * Emit everything needed to wire the **Behavioral Gate** into GitHub Actions.
 * Unlike the standard run gate (server-side, HMAC CI endpoints), BG runs the
 * quantized model on a REAL device, so it must run on a self-hosted runner with
 * the device attached, via the `edgegate-bg` composite action. This is a
 * guidance generator — it composes the workflow + `gh secret` commands + the
 * self-hosted-runner prerequisites; it makes no API call.
 */
export const setupBgGithubActionInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    api_url: z
      .string()
      .optional()
      .describe('EdgeGate API URL. Defaults to "https://edgegateapi.frozo.ai".'),
    runner_label: z
      .string()
      .optional()
      .describe('Self-hosted runner label. Defaults to "snapdragon".'),
    bundle_artifact_id: z.string().uuid().optional(),
    eval_set_artifact_id: z.string().uuid().optional(),
    reference_artifact_id: z.string().uuid().optional(),
    adb_serial: z.string().optional().describe("adb serial of the attached device."),
    system_prompt: z.string().optional(),
    device_label: z.string().optional(),
  })
  .strict();

export type SetupBgGithubActionInput = z.infer<typeof setupBgGithubActionInputSchema>;

function shquote(v: string): string {
  return `'${v.replace(/'/g, "'\\''")}'`;
}

export async function setupBgGithubActionHandler(
  _client: EdgeGateClient,
  input: SetupBgGithubActionInput
): Promise<ToolResult> {
  const apiUrl = input.api_url ?? "https://edgegateapi.frozo.ai";
  const label = input.runner_label ?? "snapdragon";
  const deviceLabel = input.device_label ?? "Samsung Galaxy S23 Ultra / Snapdragon 8 Gen 2 (SM8550)";

  const workflow = [
    `name: Behavioral Gate`,
    `on:`,
    `  pull_request:`,
    `    paths: ['models/**']   # adjust to where your model / quantization lives`,
    `jobs:`,
    `  behavioral-gate:`,
    `    runs-on: [self-hosted, ${label}]`,
    `    steps:`,
    `      - uses: actions/checkout@v4`,
    `      - uses: ./.github/actions/edgegate-bg`,
    `        with:`,
    `          api-url: ${apiUrl}`,
    `          workspace-id: \${{ secrets.EDGEGATE_WORKSPACE_ID }}`,
    `          token: \${{ secrets.EDGEGATE_TOKEN }}`,
    `          adb-serial: \${{ secrets.EDGEGATE_ADB_SERIAL }}`,
    `          bundle-artifact-id: \${{ secrets.EDGEGATE_BUNDLE_ARTIFACT_ID }}`,
    `          eval-set-artifact-id: \${{ secrets.EDGEGATE_EVAL_SET_ARTIFACT_ID }}`,
    `          reference-artifact-id: \${{ secrets.EDGEGATE_REFERENCE_ARTIFACT_ID }}`,
    `          system-prompt: \${{ secrets.EDGEGATE_SYSTEM_PROMPT }}`,
    `          device-label: ${shquote(deviceLabel)}`,
  ].join("\n");

  const secrets: Array<[string, string | undefined]> = [
    ["EDGEGATE_WORKSPACE_ID", input.workspace_id],
    ["EDGEGATE_TOKEN", "<your workspace API key>"],
    ["EDGEGATE_ADB_SERIAL", input.adb_serial],
    ["EDGEGATE_BUNDLE_ARTIFACT_ID", input.bundle_artifact_id],
    ["EDGEGATE_EVAL_SET_ARTIFACT_ID", input.eval_set_artifact_id],
    ["EDGEGATE_REFERENCE_ARTIFACT_ID", input.reference_artifact_id],
    ["EDGEGATE_SYSTEM_PROMPT", input.system_prompt],
  ];
  const ghCommands = secrets
    .map(([k, v]) => `gh secret set ${k} -b ${shquote(v ?? `<${k.toLowerCase()}>`)}`)
    .join("\n");

  const text = [
    `## EdgeGate Behavioral Gate — GitHub Actions setup`,
    ``,
    `The Behavioral Gate runs the quantized model on a **real device**, so it cannot run on`,
    `GitHub-hosted runners. It needs a **self-hosted runner with the device attached**, and`,
    `the runner's exit code is the gate (nonzero on RED → the build fails).`,
    ``,
    `**Step 1 — Self-hosted runner.** In your repo: *Settings → Actions → Runners → New`,
    `self-hosted runner*. Install it on the machine with the device and give it the label`,
    `\`${label}\`. On that machine install **Python 3.10+** and **Android platform-tools (\`adb\`)**,`,
    `connect the device over USB, enable USB debugging, and accept the prompt. Verify with`,
    `\`adb devices\` (must show "device", not "unauthorized").`,
    ``,
    `**Step 2 — Copy the action.** Copy the \`.github/actions/edgegate-bg/\` directory`,
    `(\`action.yml\` + \`create_bg_run.py\`) into your repo — it's self-contained.`,
    ``,
    `**Step 3 — Workflow.** Write this to \`.github/workflows/behavioral-gate.yml\`:`,
    ``,
    "```yaml",
    workflow,
    "```",
    ``,
    `**Step 4 — Secrets.** From the repo root:`,
    ``,
    "```bash",
    ghCommands,
    "```",
    ``,
    `Get the artifact ids from \`edgegate_check_genie_compile_status\` (bundle),`,
    `\`edgegate_publish_eval_set\` (eval-set), and \`edgegate_check_reference_capture_status\``,
    `(reference). Generate the API key at`,
    `https://edgegate.frozo.ai/workspace/${input.workspace_id}/settings#api-keys`,
    ``,
    `Once pushed, each matching PR runs the gate on the device and fails the build on a`,
    `behavioral/safety regression. The signed verdict is stored on the run and joins the`,
    `evidence chain.`,
  ].join("\n");

  return { content: [{ type: "text", text }] };
}
