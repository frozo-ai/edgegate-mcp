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
 * Behavioral-Gate runs use bg_verdict.summary; null-pipeline runs require an
 * explicit baseline and are never grouped by their shared null pipeline ID.
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
        "or the most recent completed run as a fallback. Required for runs without a pipeline, " +
        "including Behavioral-Gate runs."
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

    if (!["passed", "failed"].includes(candidateRun.status)) {
      return comparisonUnavailable(candidateRun, null, "INSUFFICIENT EVIDENCE",
        `Candidate run has status ${candidateRun.status}; only completed passed/failed runs can be compared.`);
    }
    // A null pipeline is not a shared identity: unrelated BG runs all have it.
    if (!baseline_run_id && !candidateRun.pipeline_id) {
      return { content: [{ type: "text", text: formatNoBaseline(candidateRun) }] };
    }

    if (!isBehavioralRun(candidateRun) && hasAmbiguousStandardGates(candidateRun)) {
      return comparisonUnavailable(candidateRun, null, "INSUFFICIENT EVIDENCE",
        "Standard gate evidence has unsupported, unnamed, or duplicate metric gates.");
    }

    // --- Try the backend /diff endpoint first (Scenario A fast path) ---
    // The backend stores the diff from the previous pipeline run at completion.
    // If the caller did NOT supply a baseline_run_id (or it matches what the
    // backend would pick), use the pre-computed signed diff directly.
    if (!baseline_run_id && !isBehavioralRun(candidateRun)) {
      try {
        const comparison = await client.getRunDiff(workspace_id, run_id);
        // Older backend diffs collapsed gates by metric. Inspect the stored
        // baseline too: candidate-only validation cannot detect a removed
        // duplicate policy in the baseline.
        if (!comparison.diff.is_baseline) {
          if (!comparison.previous_run_id || comparison.previous_run_id === candidateRun.id) {
            return comparisonUnavailable(candidateRun, null, "INSUFFICIENT EVIDENCE",
              "Stored diff does not identify a distinct baseline run.");
          }
          let storedBaseline: RunDetail;
          try {
            storedBaseline = await client.getRun(workspace_id, comparison.previous_run_id);
          } catch {
            return comparisonUnavailable(candidateRun, null, "INSUFFICIENT EVIDENCE",
              "Stored baseline source evidence is unavailable; gate completeness cannot be checked.");
          }
          if (isBehavioralRun(storedBaseline) || storedBaseline.pipeline_id !== candidateRun.pipeline_id ||
              !["passed", "failed"].includes(storedBaseline.status) || hasAmbiguousStandardGates(storedBaseline)) {
            return comparisonUnavailable(candidateRun, storedBaseline, "INSUFFICIENT EVIDENCE",
              "Stored baseline has incompatible or ambiguous gate evidence, including possible duplicate metric gates.");
          }
        }
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

    if (candidateRun.id === baselineRun.id) {
      return comparisonUnavailable(candidateRun, baselineRun, "NOT COMPARABLE",
        "Candidate and baseline must be different runs.");
    }
    if (!["passed", "failed"].includes(baselineRun.status)) {
      return comparisonUnavailable(candidateRun, baselineRun, "INSUFFICIENT EVIDENCE",
        `Baseline run has status ${baselineRun.status}; only completed passed/failed runs can be compared.`);
    }
    if (isBehavioralRun(candidateRun) || isBehavioralRun(baselineRun)) {
      return compareBehavioralRuns(candidateRun, baselineRun);
    }
    if (!candidateRun.pipeline_id || candidateRun.pipeline_id !== baselineRun.pipeline_id) {
      return comparisonUnavailable(candidateRun, baselineRun, "NOT COMPARABLE",
        "Standard runs must belong to the same non-null pipeline.");
    }

    if (hasAmbiguousStandardGates(baselineRun)) {
      return comparisonUnavailable(candidateRun, baselineRun, "INSUFFICIENT EVIDENCE",
        "Standard gate evidence has unsupported, unnamed, or duplicate metric gates.");
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
  if (!pipelineId) return null;
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

// ─── Behavioral-Gate evidence ──────────────────────────────────────────────

interface BehavioralSignal {
  name: string;
  passed: boolean;
  hard: boolean;
  candidate_value: number;
  reference_value: number;
  threshold: number;
}

interface BehavioralSummary {
  passed: boolean;
  backend: string;
  eval_set_sha256: string;
  signals: BehavioralSignal[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isBehavioralRun(run: RunDetail): boolean {
  return run.is_bg_run === true || run.bg_verdict != null;
}

/** Read only the signed summary; unsigned top-level convenience fields are ignored. */
function behavioralSummary(run: RunDetail): BehavioralSummary | null {
  const envelope = record(run.bg_verdict);
  const summary = record(envelope?.summary);
  if (!summary || (envelope?.version !== undefined && envelope.version !== 1) ||
      (summary.version !== undefined && summary.version !== 1) ||
      typeof summary.passed !== "boolean" ||
      typeof summary.backend !== "string" || !["cpu", "hardware", "api"].includes(summary.backend) ||
      typeof summary.eval_set_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(summary.eval_set_sha256) ||
      !Array.isArray(summary.signals) || summary.signals.length === 0) return null;

  const signals: BehavioralSignal[] = [];
  const names = new Set<string>();
  for (const value of summary.signals) {
    const signal = record(value);
    if (!signal || typeof signal.name !== "string" || !signal.name.trim() || names.has(signal.name) ||
        typeof signal.passed !== "boolean" || typeof signal.hard !== "boolean" ||
        finiteNumber(signal.candidate_value) === null || finiteNumber(signal.reference_value) === null ||
        finiteNumber(signal.threshold) === null) return null;
    names.add(signal.name);
    signals.push({
      name: signal.name, passed: signal.passed, hard: signal.hard,
      candidate_value: signal.candidate_value as number,
      reference_value: signal.reference_value as number, threshold: signal.threshold as number,
    });
  }
  // A soft failure is a warning, not a gate failure. Inconsistent summaries are
  // evidence gaps, not an excuse to derive a pass from run lifecycle status.
  if (summary.passed !== signals.every((signal) => !signal.hard || signal.passed) ||
      summary.passed !== (run.status === "passed")) return null;
  return { passed: summary.passed, backend: summary.backend,
    eval_set_sha256: summary.eval_set_sha256.toLowerCase(), signals };
}

function comparisonUnavailable(
  candidate: RunDetail,
  baseline: RunDetail | null,
  verdict: "INSUFFICIENT EVIDENCE" | "NOT COMPARABLE",
  reason: string
): ToolResult {
  return { content: [{ type: "text", text: [
    "## Run Comparison", "", `**Candidate:** \`${candidate.id}\``,
    `**Baseline:** \`${baseline?.id ?? "—"}\``, "", `### Verdict`, "",
    `**${verdict}** — ${reason}`,
  ].join("\n") }] };
}

function compareBehavioralRuns(candidate: RunDetail, baseline: RunDetail): ToolResult {
  if (!isBehavioralRun(candidate) || !isBehavioralRun(baseline)) {
    return comparisonUnavailable(candidate, baseline, "NOT COMPARABLE",
      "Behavioral-Gate and standard pipeline runs use different evidence schemas.");
  }
  const current = behavioralSummary(candidate);
  const previous = behavioralSummary(baseline);
  if (!current || !previous) {
    return comparisonUnavailable(candidate, baseline, "INSUFFICIENT EVIDENCE",
      "Behavioral-Gate summary is missing, incomplete, inconsistent, or unsupported. " +
      "Both runs need a supported summary with boolean outcomes, named signals, and an eval-set SHA-256.");
  }
  if (current.eval_set_sha256 !== previous.eval_set_sha256 || current.backend !== previous.backend) {
    return comparisonUnavailable(candidate, baseline, "NOT COMPARABLE",
      "Behavioral-Gate runs must use the same eval-set SHA-256 and execution backend. " +
      `Baseline: ${previous.eval_set_sha256} (${previous.backend}); ` +
      `candidate: ${current.eval_set_sha256} (${current.backend}).`);
  }
  const previousByName = new Map(previous.signals.map((signal) => [signal.name, signal]));
  if (current.signals.length !== previous.signals.length || current.signals.some((signal) => {
    const prev = previousByName.get(signal.name);
    return !prev || prev.hard !== signal.hard || prev.threshold !== signal.threshold ||
      prev.reference_value !== signal.reference_value;
  })) {
    return comparisonUnavailable(candidate, baseline, "NOT COMPARABLE",
      "Behavioral-Gate signal names, hard/soft policies, thresholds, or reference values changed. " +
      "Use runs evaluated under the same gate configuration and reference evidence.");
  }

  const signals = [...current.signals].sort((a, b) => a.name.localeCompare(b.name));
  const hasRegression = signals.some((signal) =>
    signal.hard && !signal.passed && previousByName.get(signal.name)!.passed);
  const hasRecovery = signals.some((signal) =>
    signal.hard && signal.passed && !previousByName.get(signal.name)!.passed);
  const verdict = hasRegression ? "REGRESSION" : hasRecovery ? "IMPROVEMENT" : "NEUTRAL";
  const lines = [
    "## Run Comparison", "", "**Evidence:** Behavioral-Gate summary",
    `**Candidate:** \`${candidate.id}\` (${candidate.completed_at ?? "—"})`,
    `**Baseline:** \`${baseline.id}\` (${baseline.completed_at ?? "—"})`,
    `**Eval-set SHA-256:** \`${current.eval_set_sha256}\``,
    `**Execution backend:** ${current.backend}`, "",
    `**Overall gate:** ${previous.passed ? "PASS" : "FAIL"} → ${current.passed ? "PASS" : "FAIL"}`,
    "", "### Metrics", "| Signal | Baseline value | Candidate value | Delta | Threshold |",
    "|---|---|---|---|---|",
  ];
  for (const signal of signals) {
    const prev = previousByName.get(signal.name)!;
    lines.push(`| ${signal.name} | ${fmt(prev.candidate_value)} | ${fmt(signal.candidate_value)} | ` +
      `${fmtDelta(signal.candidate_value - prev.candidate_value)} | ${signal.threshold} |`);
  }
  lines.push("", "### Gate Status", "| Signal | Policy | Baseline | Candidate | Status |",
    "|---|---|---|---|---|");
  for (const signal of signals) {
    const prev = previousByName.get(signal.name)!;
    const transition = prev.passed === signal.passed
      ? signal.passed ? "unchanged" : "still_failing"
      : signal.passed ? "improved" : "regressed";
    const label = signal.hard ? flipLabel(transition)
      : signal.passed ? "advisory passing" : "advisory warning (does not fail gate)";
    lines.push(`| ${signal.name} | ${signal.hard ? "hard" : "soft"} | ${gateIcon(prev.passed)} | ` +
      `${gateIcon(signal.passed)} | ${label} |`);
  }
  lines.push("", "### Verdict", "", `**${verdict}** — ` + (hasRegression
    ? "one or more hard behavioral signals regressed."
    : hasRecovery ? "previously-failing hard behavioral signals now pass; no hard-signal regressions."
    : "no hard behavioral signal pass/fail changes; soft signals are advisory."),
    "", "### Audit Trail",
    "Diff computed client-side from bg_verdict.summary (unsigned; no diff SHA-256). " +
      "This comparison does not independently verify the source signatures.",
    "This diff compares reported gate results. Matching summary fields do not establish identical " +
      "reference artifacts, endpoint bindings, decode configuration, or independent behavioral parity.");
  return { content: [{ type: "text", text: lines.join("\n") }] };
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
    const cur = finiteNumber(candidateMetrics[k]);
    const prev = finiteNumber(baselineMetrics[k]);
    const delta = cur !== null && prev !== null ? cur - prev : null;
    const delta_pct =
      delta !== null && prev !== null && prev !== 0 ? (delta / prev) * 100 : null;
    metric_deltas[k] = { current: cur, previous: prev, delta, delta_pct };
  }

  // Gate flips
  const candidateGates = Array.isArray(candidate.gates_eval?.gates) ? candidate.gates_eval.gates : [];
  const baselineGates = Array.isArray(baseline.gates_eval?.gates) ? baseline.gates_eval.gates : [];
  const prevByMetric = new Map(baselineGates.map((g) => [g.metric, g]));
  const currByMetric = new Map(candidateGates.map((g) => [g.metric, g]));
  const allGateMetrics = new Set([...prevByMetric.keys(), ...currByMetric.keys()]);
  const gate_flips: GateFlip[] = [];
  for (const m of [...allGateMetrics].sort()) {
    const prev = prevByMetric.get(m) ?? null;
    const curr = currByMetric.get(m) ?? null;
    const transition = classifyGateFlip(prev, curr);
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

function hasAmbiguousStandardGates(run: RunDetail): boolean {
  const gates = run.gates_eval?.gates;
  if (gates === undefined || gates === null) return false;
  if (!Array.isArray(gates)) return true;
  const seen = new Set<string>();
  return gates.some((gate) => {
    if (!record(gate) || typeof gate.metric !== "string" || !gate.metric.trim()) return true;
    if (seen.has(gate.metric)) return true;
    seen.add(gate.metric);
    return false;
  });
}

const GATE_OPERATORS = new Set(["lt", "lte", "gt", "gte", "eq", "<", "<=", ">", ">=", "=="]);

/** Older backend diffs coerced missing booleans and did not check gate-policy
 * changes. Re-derive display labels without modifying the signed payload. */
function classifyGateFlip(previous: GateFlip["previous"], current: GateFlip["current"]): string {
  if (!previous) return "new";
  if (!current) return "removed";
  if (typeof previous.passed !== "boolean" || typeof current.passed !== "boolean") return "unknown";
  if ([previous, current].some((gate) => finiteNumber(gate.threshold) === null ||
    typeof gate.operator !== "string" || !GATE_OPERATORS.has(gate.operator))) return "not_comparable";
  if (previous.threshold !== current.threshold || previous.operator !== current.operator) return "not_comparable";
  if (previous.passed && current.passed) return "unchanged";
  if (!previous.passed && current.passed) return "improved";
  if (previous.passed && !current.passed) return "regressed";
  return "still_failing";
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function renderComparison(comparison: RunComparison, candidateRun: RunDetail): string {
  const diff = comparison.diff;
  const lines: string[] = [];

  // Header
  lines.push(
    `## Run Comparison`,
    ``,
    `**Pipeline:** ${candidateRun.pipeline_name ?? "—"} (${candidateRun.pipeline_id ?? "—"})`,
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

  // Normalize labels from source values; leave the original diff/hash untouched.
  const duplicateMetrics = new Set(diff.gate_flips.filter((gate, index, gates) =>
    gates.findIndex((other) => other.metric === gate.metric) !== index).map((gate) => gate.metric));
  const gateFlips = diff.gate_flips.map((gate) => ({
    ...gate, transition: duplicateMetrics.has(gate.metric) ? "not_comparable" : classifyGateFlip(gate.previous, gate.current),
  }));
  if (gateFlips.length > 0) {
    lines.push(`### Gate Status`);
    lines.push(`| Gate | Baseline | Candidate | Status |`);
    lines.push(`|---|---|---|---|`);
    for (const gf of gateFlips) {
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
  const verdict = computeVerdict(gateFlips, diff.metric_deltas);
  if (gateFlips.some((gate) => ["unknown", "not_comparable", "new", "removed"].includes(gate.transition))) {
    lines.push("Evidence gap: some gates are missing outcomes or use different policies. " +
      "Only compatible, observed outcomes can establish a gate regression or recovery.", "");
  }
  lines.push(`### Verdict`);
  lines.push(``);
  lines.push(verdictBadge(verdict));
  lines.push(``);

  // Audit trail
  lines.push(`### Audit Trail`);
  if (comparison.diff_sha256) {
    lines.push(`Diff SHA-256: \`${comparison.diff_sha256}\` (reported as signed and embedded in the evidence bundle; signature not independently verified by this tool)`);
    lines.push("The digest refers to the original backend diff; displayed gate labels are derived from its reported outcomes and policies.");
  } else {
    lines.push(`Diff computed client-side from run details (unsigned; no diff SHA-256).`);
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
  const explanation = candidateRun.pipeline_id
    ? `No prior completed runs were found in pipeline "${candidateRun.pipeline_name}".`
    : "This run has no pipeline. Supply baseline_run_id explicitly; unrelated runs with null pipeline IDs are not auto-matched.";
  return [
    `## Run Comparison`,
    ``,
    `**Pipeline:** ${candidateRun.pipeline_name ?? "—"} (${candidateRun.pipeline_id ?? "—"})`,
    `**Candidate:** \`${candidateRun.id}\``,
    ``,
    `> **NO BASELINE** — ${explanation}`,
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
  if (typeof passed !== "boolean") return "—";
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
    case "unknown":   return "unknown (missing pass/fail evidence)";
    case "not_comparable": return "not comparable (gate policy changed)";
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
): "REGRESSION" | "IMPROVEMENT" | "NEUTRAL" | "INSUFFICIENT EVIDENCE" {
  const hasRegression = gateFlips.some((gf) => gf.transition === "regressed" &&
    gf.previous?.passed === true && gf.current?.passed === false);
  const hasRecovery = gateFlips.some((gf) => gf.transition === "improved" &&
    gf.previous?.passed === false && gf.current?.passed === true);

  // Also flag metric-only regression even if no gate flip
  const significantMetricRegression = Object.entries(metricDeltas).some(([k, m]) => {
    if (!LOWER_IS_BETTER.has(k)) return false;
    return finiteNumber(m.previous) !== null && finiteNumber(m.current) !== null &&
      finiteNumber(m.delta_pct) !== null && m.delta_pct! >= REGRESSION_THRESHOLD_PCT;
  });

  if (hasRegression || significantMetricRegression) return "REGRESSION";
  const comparableGates = gateFlips.filter((gf) =>
    typeof gf.previous?.passed === "boolean" && typeof gf.current?.passed === "boolean" &&
    ["unchanged", "still_failing", "improved", "regressed"].includes(gf.transition)
  );
  const hasComparableMetrics = Object.values(metricDeltas).some((m) =>
    finiteNumber(m.previous) !== null && finiteNumber(m.current) !== null
  );
  if ((gateFlips.length > 0 && comparableGates.length !== gateFlips.length) ||
      (comparableGates.length === 0 && !hasComparableMetrics)) return "INSUFFICIENT EVIDENCE";
  if (hasRecovery) return "IMPROVEMENT";
  return "NEUTRAL";
}

function verdictBadge(verdict: string): string {
  switch (verdict) {
    case "REGRESSION":  return `**REGRESSION** — one or more gates regressed or a lower-is-better metric increased by ≥${REGRESSION_THRESHOLD_PCT}%.`;
    case "IMPROVEMENT": return `**IMPROVEMENT** — previously-failing gates now pass; no regressions.`;
    case "NEUTRAL":     return `**NEUTRAL** — no gate flips and no significant metric regressions.`;
    case "INSUFFICIENT EVIDENCE": return `**INSUFFICIENT EVIDENCE** — missing or incomparable gate/metric evidence; no neutral verdict can be established.`;
    case "NO BASELINE": return `**NO BASELINE** — no prior run to compare against.`;
    default:            return `**${verdict}**`;
  }
}
