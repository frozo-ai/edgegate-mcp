import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { ToolResult } from "./setup_workspace.js";

export const predictNpuCoverageInputSchema = z.object({
  workspace_id: z.string().uuid(),
  artifact_id: z.string().uuid(),
});

export type PredictNpuCoverageInput = z.infer<typeof predictNpuCoverageInputSchema>;

interface CpuFallbackOp {
  op_type: string;
  reason: string | null;
  recommendation: string | null;
  compute_pct?: number;
}

interface Recommendation {
  op: string;
  fix: string;
}

interface NpuCoverage {
  total_ops: number;
  npu_ops: number;
  cpu_ops: number;
  conditional_ops: number;
  predicted_npu_coverage: number;
  compute_weighted_npu_coverage: number;
  compute_weighted: boolean;
  cpu_fallback_ops: CpuFallbackOp[];
  recommendations: Recommendation[];
  model_name: string;
  risk_level: "low" | "medium" | "high";
  summary: string;
  op_table_version: string;
}

export async function predictNpuCoverageHandler(
  client: EdgeGateClient,
  input: PredictNpuCoverageInput
): Promise<ToolResult> {
  try {
    const p = (await client.predictNpuCoverage(
      input.workspace_id,
      input.artifact_id
    )) as unknown as NpuCoverage;

    const lines: string[] = [
      `**NPU coverage prediction — ${p.model_name}**  (heuristic — no AI Hub credits spent)`,
      ``,
      `- risk: **${p.risk_level.toUpperCase()}**`,
      `- compute on NPU: **${p.compute_weighted_npu_coverage}%**${p.compute_weighted ? "" : " (estimated — shape inference unavailable for this graph)"}`,
      `- ops on NPU: ${p.predicted_npu_coverage}% (${p.npu_ops}/${p.total_ops})`,
      ``,
      p.summary,
    ];

    // The op-count vs compute-weighted divergence is the actionable insight.
    const divergence = p.compute_weighted_npu_coverage - p.predicted_npu_coverage;
    if (p.compute_weighted && Math.abs(divergence) >= 10) {
      lines.push(
        ``,
        divergence > 0
          ? "> Looks worse by op count than it is — the fallbacks sit on cheap paths; the heavy ops run on the NPU."
          : "> Looks better by op count than it is — a fallback sits on the heavy path, so latency impact is larger than the op count suggests."
      );
    }

    if (p.cpu_fallback_ops.length > 0) {
      lines.push(``, `**CPU fallbacks:**`);
      for (const op of p.cpu_fallback_ops.slice(0, 10)) {
        const pct =
          typeof op.compute_pct === "number" ? ` — ${op.compute_pct}% of compute` : "";
        lines.push(`- ${op.op_type}${pct}`);
      }
    }

    if (p.recommendations.length > 0) {
      lines.push(``, `**Fixes:**`);
      for (const r of p.recommendations) {
        lines.push(`- \`${r.op}\`: ${r.fix}`);
      }
    }

    lines.push(
      ``,
      `_Calibrated against ${p.op_table_version}. The real device run remains authoritative._`
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    if (err instanceof EdgeGateError) {
      const msg =
        err.status === 400
          ? `NPU coverage prediction only supports ONNX models. ${err.detail}`
          : err.status === 401
            ? "EDGEGATE_API_KEY is missing, expired, or revoked. Generate a fresh key at " +
              "https://edgegate.frozo.ai/workspace/<id>/settings#api-keys and retry."
            : err.status === 404
              ? `Artifact not found in this workspace. ${err.detail}`
              : `EdgeGate returned ${err.status}: ${err.detail}`;
      return { isError: true, content: [{ type: "text", text: msg }] };
    }
    throw err;
  }
}
