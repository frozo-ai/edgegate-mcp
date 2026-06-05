import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { HFImportJob } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const importHuggingfaceModelInputSchema = z.object({
  workspace_id: z.string().uuid(),
  hf_repo_id: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, 'hf_repo_id must be in "<owner>/<name>" format, e.g. "microsoft/resnet-50"'),
  revision: z.string().optional().default("main"),
  filename: z.string().optional(),
  poll_for_completion: z.boolean().optional().default(true),
  max_poll_seconds: z
    .number()
    .int()
    .min(1)
    .max(900)
    .optional()
    .default(300),
});

export type ImportHuggingfaceModelInput = z.infer<typeof importHuggingfaceModelInputSchema>;

const POLL_INTERVAL_MS = 5_000;

export async function importHuggingfaceModelHandler(
  client: EdgeGateClient,
  input: ImportHuggingfaceModelInput
): Promise<ToolResult> {
  try {
    const body: { hf_repo_id: string; revision?: string; filename?: string } = {
      hf_repo_id: input.hf_repo_id,
      revision: input.revision,
    };
    if (input.filename !== undefined) {
      body.filename = input.filename;
    }

    const job = await client.startHuggingFaceImport(input.workspace_id, body);

    if (!input.poll_for_completion) {
      return {
        content: [
          {
            type: "text",
            text: [
              `Import started for **${input.hf_repo_id}**.`,
              ``,
              `- import_job_id: ${job.import_job_id}`,
              `- status: ${job.status}`,
              ``,
              `To check progress, call:`,
              `  \`edgegate_import_huggingface_model({ workspace_id: "${input.workspace_id}", hf_repo_id: "${input.hf_repo_id}", poll_for_completion: true })\``,
              ``,
              `Or wait and re-run with the same arguments — polling will pick up where it left off.`,
            ].join("\n"),
          },
        ],
      };
    }

    // Poll until done / failed / timeout
    const deadlineMs = Date.now() + input.max_poll_seconds * 1_000;
    let latest: HFImportJob = job;

    while (latest.status !== "done" && latest.status !== "failed") {
      if (Date.now() >= deadlineMs) {
        return {
          content: [
            {
              type: "text",
              text: [
                `Import of **${input.hf_repo_id}** is still running after ${input.max_poll_seconds}s.`,
                ``,
                `- import_job_id: ${latest.import_job_id}`,
                `- current status: ${latest.status}`,
                ``,
                `The import is continuing in the background. Check back in a minute by calling this`,
                `tool again with the same arguments (poll_for_completion: true).`,
              ].join("\n"),
            },
          ],
        };
      }

      await sleep(POLL_INTERVAL_MS);
      latest = await client.getHuggingFaceImportJob(input.workspace_id, latest.import_job_id);
    }

    if (latest.status === "failed") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: [
              `Import of **${input.hf_repo_id}** failed.`,
              ``,
              `- import_job_id: ${latest.import_job_id}`,
              `- error: ${latest.error_detail ?? "unknown error"}`,
              ``,
              `Common causes:`,
              `- The repository does not contain an ONNX file (EdgeGate v1 requires pre-built ONNX)`,
              `- The repository is private (only public repos are supported in v1)`,
              `- The revision or filename you specified does not exist`,
            ].join("\n"),
          },
        ],
      };
    }

    // status === "done"
    const sizeLabel =
      latest.size_bytes !== null
        ? `${(latest.size_bytes / 1_048_576).toFixed(1)} MB`
        : "unknown size";

    return {
      content: [
        {
          type: "text",
          text: [
            `Import complete: **${input.hf_repo_id}**`,
            ``,
            `- artifact_id: ${latest.artifact_id}`,
            `- filename: ${latest.filename ?? "(unknown)"}`,
            `- size: ${sizeLabel}`,
            ``,
            `Use this artifact_id in \`edgegate_create_pipeline\` to gate this model:`,
            `  models: [{ name: "${input.hf_repo_id}", artifact_id: "${latest.artifact_id}" }]`,
          ].join("\n"),
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
              err.status === 402
                ? `Your plan does not allow Hugging Face imports. Upgrade at https://edgegate.frozo.ai/pricing.\n\nDetail: ${err.detail}`
                : err.status === 401
                  ? "EDGEGATE_API_KEY is missing, expired, or revoked. Generate a fresh key at " +
                    "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys and retry."
                  : `EdgeGate returned ${err.status}: ${err.detail}`,
          },
        ],
      };
    }
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
