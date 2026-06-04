import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const setupGithubActionInputSchema = z.object({
  workspace_id: z.string().uuid(),
  pipeline_id: z.string().uuid().optional(),
  model_artifact_id: z.string().uuid().optional(),
});

export type SetupGithubActionInput = z.infer<typeof setupGithubActionInputSchema>;

export async function setupGithubActionHandler(
  client: EdgeGateClient,
  input: SetupGithubActionInput
): Promise<ToolResult> {
  try {
    const tmpl = await client.getWorkflowTemplate(input.workspace_id);
    const ghCommands = buildGhCommands({
      workspace_id: input.workspace_id,
      pipeline_id: input.pipeline_id,
      model_artifact_id: input.model_artifact_id,
    });
    const text = [
      `## EdgeGate GitHub Action setup`,
      ``,
      `**Step 1.** Write this workflow to your repo:`,
      ``,
      "```yaml",
      `# .github/workflows/edgegate.yml`,
      tmpl.workflow_yaml.trimEnd(),
      "```",
      ``,
      `**Step 2.** From the repo root, run these \`gh\` CLI commands to set the secrets:`,
      ``,
      "```bash",
      ghCommands,
      "```",
      ``,
      `**Step 3.** Need an API_SECRET? Generate one in the EdgeGate dashboard:`,
      `https://edgegate.frozo.ai/workspace/${input.workspace_id}/settings#integrations`,
      ``,
      `Once committed and pushed, every PR to \`main\` will trigger an EdgeGate run ` +
        `and post the results back as a PR comment.`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch workflow template: ${err.detail}` }],
      };
    }
    throw err;
  }
}

function buildGhCommands(args: {
  workspace_id: string;
  pipeline_id?: string;
  model_artifact_id?: string;
}): string {
  const lines = [
    `gh secret set EDGEGATE_WORKSPACE_ID --body "${args.workspace_id}"`,
    `gh secret set EDGEGATE_API_SECRET --body "<paste-secret-from-dashboard>"`,
  ];
  if (args.pipeline_id) {
    lines.push(`gh secret set EDGEGATE_PIPELINE_ID --body "${args.pipeline_id}"`);
  } else {
    lines.push(`# Optional: gh secret set EDGEGATE_PIPELINE_ID --body "<pipeline-uuid>"`);
  }
  if (args.model_artifact_id) {
    lines.push(`gh secret set EDGEGATE_MODEL_ARTIFACT_ID --body "${args.model_artifact_id}"`);
  } else {
    lines.push(`# Optional: gh secret set EDGEGATE_MODEL_ARTIFACT_ID --body "<artifact-uuid>"`);
  }
  return lines.join("\n");
}
