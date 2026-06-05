/**
 * edgegate_compare_runs — run-over-run diff with smart auto-baseline selection.
 *
 * When baseline_run_id is omitted:
 *  1. Fetch candidate run's pipeline_id
 *  2. List last 20 runs in that pipeline
 *  3. Pick the most recent PASSED run with a bundle (excluding candidate itself)
 *  4. Fallback: most recent completed run (any status) excluding candidate
 *  5. If nothing found: "NO BASELINE" response
 *
 * The backend already exposes GET /v1/workspaces/{id}/runs/{run_id}/diff which
 * returns the pre-computed, signed diff embedded in the evidence bundle (commit
 * 41167a6). We call that endpoint for the candidate run — it internally uses
 * the baseline the Celery task stored at completion time. When the user
 * explicitly provides a baseline_run_id that differs from what the backend
 * stored, we fall back to client-side diff from both runs' detail endpoints.
 */

import { z } from "zod";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import type { GateFlip, MetricDelta, RunComparison, RunDetail } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const compareRunsInputSchema = z.object({
  workspace_id: z.string().uuid(),
  run_id: z.string().uuid().describe("Candidate run to evaluate"),
  baseline_run_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Baseline to compare against. When omitted, auto-selects the most recent " +
        "PASSED run from the same pipeline (excluding the candidate itself), " +
        "or the most recent completed run as a fallback."
    ),
});

export type CompareRunsInput = z.infer<typeof compareRunsInputSchema>;

// Metrics where lower is better (high delta% is bad)
const LOWER_IS_BETTER = new Set(["inference_time_ms", "peak_memory_mb", "latency_ms"]);
// Threshold for "significant regression" in lower-is-better metrics
const REGRESSION_THRESHOLD_PCT = 25;

export async function compareRunsHandler(
  client: EdgeGateClient,
  input: CompareRunsInput
): Promise<ToolResult> {
  try {
    const { workspace_id, run_id, baseline_run_id } = input;

    // --- Fetch candidate run detail (need pipeline_id for auto-baseline) ---
    let candidateRun: RunDetail;
    try {
      candidateRun = await client.getRun(workspace_id, run_id);
    } catch (err) {
      if (err instanceof EdgeGateError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Could not fetch candidate run ${run_id}: ${err.detail}`,
            },
          ],
        };
      }
      throw err;
    }

    // --- Try the backend /diff endpoint first (Scenario A fast path) ---
    // The backend stores the diff from the previous pipeline run at completion.
    // If the caller did NOT supply a baseline_run_id (or it matches what the
    // backend would pick), use the pre-computed signed diff directly.
    if (!baseline_run_id) {
      try {
        const comparison = await client.getRunDiff(workspace_id, run_id);
        // Backend returned a diff — render it
        return { content: [{ type: "text", text: renderComparison(comparison, candidateRun) }] };
      } catch (diffErr) {
        if (diffErr instanceof EdgeGateError && diffErr.status === 404) {
          // No server-side diff yet: either first run or still in flight.
          // Attempt client-side auto-baseline selection.
        } else {
          // Unexpected error — propagate
          if (diffErr instanceof EdgeGateError) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `EdgeGate returned ${diffErr.status} fetching diff: ${diffErr.detail}`,
                },
              ],
            };
          }
          throw diffErr;
        }
      }
    }

    // --- Auto-baseline or explicit baseline: client-side path ---
    let resolvedBaselineId: string | null = baseline_run_id ?? null;

    if (!resolvedBaselineId) {
      // Auto-select: list recent runs in the same pipeline
      resolvedBaselineId = await pickAutoBaseline(client, workspace_id, candidateRun);
      if (!resolvedBaselineId) {
        return {
          content: [
            {
              type: "text",
              text: formatNoBaseline(candidateRun),
            },
          ],
        };
      }
    }

    // Fetch baseline run detail
    let baselineRun: RunDetail;
    try {
      baselineRun = await client.getRun(workspace_id, resolvedBaselineId);
    } catch (err) {
      if (err instanceof EdgeGateError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Could not fetch baseline run ${resolvedBaselineId}: ${err.detail}`,
            },
          ],
        };
      }
      throw err;
    }

    // Build client-side diff
    const comparison = buildClientSideDiff(candidateRun, baselineRun);
    return { content: [{ type: "text", text: renderComparison(comparison, candidateRun) }] };
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

// ─── Auto-baseline selection ───────────────────────────────────────────────

async function pickAutoBaseline(
  client: EdgeGateClient,
  workspaceId: string,
  candidateRun: RunDetail
): Promise<string | null> {
  const pipelineId = candidateRun.pipeline_id;
  let runs;
  try {
    runs = await client.listRunsByPipeline(workspaceId, pipelineId, 20);
  } catch {
    // Fall back to listing all runs if pipeline filter fails
    try {
      runs = await client.listRuns(workspaceId, 20);
    } catch {
      return null;
    }
  }

  // Filter to same pipeline, excluding candidate itself
  const eligible = runs.filter(
    (r) => r.id !== candidateRun.id && r.pipeline_id === pipelineId
  );

  // Priority 1: most recent PASSED with a bundle
  // (RunSummary doesn't have bundle_artifact_id, but passed status implies a bundle)
  const passedRun = eligible.find((r) => r.status === "passed");
  if (passedRun) return passedRun.id;

  // Priority 2: most recent completed run (any terminal status)
  const completedRun = eligible.find((r) =>
    ["passed", "failed", "error"].includes(r.status)
  );
  if (completedRun) return completedRun.id;

  return null;
}

// ─── Client-side diff construction ────────────────────────────────────────

function buildClientSideDiff(candidate: RunDetail, baseline: RunDetail): RunComparison {
  const candidateMetrics = candidate.normalized_metrics ?? {};
  const baselineMetrics = baseline.normalized_metrics ?? {};

  // Metric deltas
  const allMetricKeys = new Set([
    ...Object.keys(candidateMetrics),
    ...Object.keys(baselineMetrics),
  ]);
  const metric_deltas: Record<string, MetricDelta> = {};
  for (const k of allMetricKeys) {
    const cur = candidateMetrics[k] ?? null;
    const prev = baselineMetrics[k] ?? null;
    const delta = cur !== null && prev !== null ? cur - prev : null;
    const delta_pct =
      delta !== null && prev !== null && prev !== 0 ? (delta / prev) * 100 : null;
    metric_deltas[k] = { current: cur, previous: prev, delta, delta_pct };
  }

  // Gate flips
  const candidateGates = candidate.gates_eval?.gates ?? [];
  const baselineGates = baseline.gates_eval?.gates ?? [];
  const prevByMetric = new Map(baselineGates.map((g) => [g.metric, g]));
  const currByMetric = new Map(candidateGates.map((g) => [g.metric, g]));
  const allGateMetrics = new Set([...prevByMetric.keys(), ...currByMetric.keys()]);
  const gate_flips: GateFlip[] = [];
  for (const m of [...allGateMetrics].sort()) {
    const prev = prevByMetric.get(m) ?? null;
    const curr = currByMetric.get(m) ?? null;
    let transition: string;
    if (!prev) transition = "new";
    else if (!curr) transition = "removed";
    else {
      const p = prev.passed;
      const c = curr.passed;
      if (c && p) transition = "unchanged";
      else if (c && !p) transition = "improved";
      else if (!c && p) transition = "regressed";
      else transition = "still_failing";
    }
    gate_flips.push({
      metric: m,
      transition,
      previous: prev
        ? {
            passed: prev.passed,
            threshold: prev.threshold,
            operator: prev.operator,
            actual_value: prev.actual_value,
          }
        : null,
      current: curr
        ? {
            passed: curr.passed,
            threshold: curr.threshold,
            operator: curr.operator,
            actual_value: curr.actual_value,
          }
        : null,
    });
  }

  return {
    current_run_id: candidate.id,
    previous_run_id: baseline.id,
    diff_sha256: null, // client-side, not signed
    diff: {
      current_run_id: candidate.id,
      previous_run_id: baseline.id,
      current_commit: {},
      previous_commit: {},
      current_completed_at: candidate.completed_at,
      previous_completed_at: baseline.completed_at,
      metric_deltas,
      gate_flips,
      per_device: null,
      per_cell: null,
      is_baseline: false,
    },
    created_at: new Date().toISOString(),
  };
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function renderComparison(comparison: RunComparison, candidateRun: RunDetail): string {
  const diff = comparison.diff;
  const lines: string[] = [];

  // Header
  lines.push(
    `## Run Comparison`,
    ``,
    `**Pipeline:** ${candidateRun.pipeline_name} (${candidateRun.pipeline_id})`,
    `**Candidate:** \`${comparison.current_run_id}\`  ` +
      `(${diff.current_completed_at ?? "in flight"})`,
    `**Baseline:**  \`${comparison.previous_run_id ?? "—"}\`  ` +
      `(${diff.previous_completed_at ?? "—"})`,
    ``
  );

  if (diff.is_baseline) {
    lines.push(`> **NO BASELINE** — this is the first completed run in this pipeline.`);
    lines.push(``);
    return lines.join("\n");
  }

  // Commit context (only if server-side diff has it)
  const cc = diff.current_commit;
  const pc = diff.previous_commit;
  if (cc?.sha || pc?.sha) {
    lines.push(`### Commit Context`);
    if (cc?.sha) lines.push(`**Candidate:** \`${cc.sha}\` — ${cc.message ?? ""}`);
    if (pc?.sha) lines.push(`**Baseline:** \`${pc.sha}\` — ${pc.message ?? ""}`);
    lines.push(``);
  }

  // Metrics
  const metricKeys = Object.keys(diff.metric_deltas).sort();
  if (metricKeys.length > 0) {
    lines.push(`### Metrics`);
    lines.push(`| Metric | Baseline | Candidate | Delta | Direction |`);
    lines.push(`|---|---|---|---|---|`);
    for (const k of metricKeys) {
      const m = diff.metric_deltas[k];
      const pct = m.delta_pct !== null ? `${m.delta_pct > 0 ? "+" : ""}${m.delta_pct.toFixed(1)}%` : "—";
      const arrow = m.delta === null ? "" : m.delta > 0 ? "↑" : m.delta < 0 ? "↓" : "→";
      const direction = m.delta === null ? "—" : buildDirectionLabel(k, m.delta);
      lines.push(
        `| ${k} | ${fmt(m.previous)} | ${fmt(m.current)} | ${fmtDelta(m.delta)} (${pct}) ${arrow} | ${direction} |`
      );
    }
    lines.push(``);
  }

  // Gate flips
  if (diff.gate_flips.length > 0) {
    lines.push(`### Gate Status`);
    lines.push(`| Gate | Baseline | Candidate | Status |`);
    lines.push(`|---|---|---|---|`);
    for (const gf of diff.gate_flips) {
      const baseIcon = gateIcon(gf.previous?.passed ?? null);
      const candIcon = gateIcon(gf.current?.passed ?? null);
      const statusLabel = flipLabel(gf.transition);
      lines.push(`| ${gf.metric} | ${baseIcon} | ${candIcon} | ${statusLabel} |`);
    }
    lines.push(``);
  }

  // Per-device breakdown
  if (diff.per_device && Object.keys(diff.per_device).length > 0) {
    lines.push(`### Per-Device Breakdown`);
    for (const [device, metrics] of Object.entries(diff.per_device)) {
      lines.push(`**${device}**`);
      for (const [k, m] of Object.entries(metrics)) {
        const pct = m.delta_pct !== null ? `${m.delta_pct > 0 ? "+" : ""}${m.delta_pct.toFixed(1)}%` : "—";
        lines.push(`  - ${k}: ${fmt(m.previous)} → ${fmt(m.current)} (${pct})`);
      }
    }
    lines.push(``);
  }

  // Verdict
  const verdict = computeVerdict(diff.gate_flips, diff.metric_deltas);
  lines.push(`### Verdict`);
  lines.push(``);
  lines.push(verdictBadge(verdict));
  lines.push(``);

  // Audit trail
  lines.push(`### Audit Trail`);
  if (comparison.diff_sha256) {
    lines.push(`Diff SHA-256: \`${comparison.diff_sha256}\` (signed, embedded in evidence bundle)`);
  } else {
    lines.push(`Diff computed client-side (no SHA-256 — backend diff not yet available for this run)`);
  }
  if (candidateRun.bundle_artifact_id) {
    lines.push(`Candidate bundle artifact: \`${candidateRun.bundle_artifact_id}\``);
  }
  if (comparison.previous_run_id) {
    lines.push(`Baseline run ID: \`${comparison.previous_run_id}\``);
  }

  return lines.join("\n");
}

function formatNoBaseline(candidateRun: RunDetail): string {
  return [
    `## Run Comparison`,
    ``,
    `**Pipeline:** ${candidateRun.pipeline_name} (${candidateRun.pipeline_id})`,
    `**Candidate:** \`${candidateRun.id}\``,
    ``,
    `> **NO BASELINE** — this is the first completed run in pipeline "${candidateRun.pipeline_name}", ` +
      `or no prior completed runs were found. There is nothing to compare against yet.`,
    ``,
    `**Verdict: NO BASELINE**`,
  ].join("\n");
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmt(v: number | null): string {
  return v === null ? "—" : v.toFixed(2);
}

function fmtDelta(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function gateIcon(passed: boolean | null): string {
  if (passed === null) return "—";
  return passed ? "✓" : "✗";
}

function flipLabel(transition: string): string {
  switch (transition) {
    case "regressed": return "**REGRESSION** ✓→✗";
    case "improved":  return "RECOVERY ✗→✓";
    case "unchanged": return "passing";
    case "still_failing": return "still failing";
    case "new":       return "new gate";
    case "removed":   return "removed";
    default:          return transition;
  }
}

function buildDirectionLabel(metric: string, delta: number): string {
  if (delta === 0) return "no change";
  const lowerBetter = LOWER_IS_BETTER.has(metric);
  if (lowerBetter) {
    return delta > 0 ? "worse ↑" : "better ↓";
  }
  return delta > 0 ? "better ↑" : "worse ↓";
}

function computeVerdict(
  gateFlips: GateFlip[],
  metricDeltas: Record<string, MetricDelta>
): "REGRESSION" | "IMPROVEMENT" | "NEUTRAL" | "NO BASELINE" {
  const hasRegression = gateFlips.some((gf) => gf.transition === "regressed");
  const hasRecovery = gateFlips.some((gf) => gf.transition === "improved");

  // Also flag metric-only regression even if no gate flip
  const significantMetricRegression = Object.entries(metricDeltas).some(([k, m]) => {
    if (!LOWER_IS_BETTER.has(k)) return false;
    return m.delta_pct !== null && m.delta_pct >= REGRESSION_THRESHOLD_PCT;
  });

  if (hasRegression || significantMetricRegression) return "REGRESSION";
  if (hasRecovery && !hasRegression) return "IMPROVEMENT";
  return "NEUTRAL";
}

function verdictBadge(verdict: string): string {
  switch (verdict) {
    case "REGRESSION":  return `**REGRESSION** — one or more gates regressed or a lower-is-better metric increased by ≥${REGRESSION_THRESHOLD_PCT}%.`;
    case "IMPROVEMENT": return `**IMPROVEMENT** — previously-failing gates now pass; no regressions.`;
    case "NEUTRAL":     return `**NEUTRAL** — no gate flips and no significant metric regressions.`;
    case "NO BASELINE": return `**NO BASELINE** — no prior run to compare against.`;
    default:            return `**${verdict}**`;
  }
}
