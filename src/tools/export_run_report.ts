/**
 * edgegate_export_run_report — render a human-readable markdown report for a
 * completed (or in-flight) EdgeGate run and write it to disk.
 *
 * Steps:
 *  1. Fetch run detail via getRun
 *  2. If the run is completed, fetch the evidence bundle via getRunBundle
 *  3. Optionally fetch the run diff via getRunDiff (when include_diff=true)
 *  4. Render a comprehensive markdown report
 *  5. Write the file to disk (creating parent directories as needed)
 *  6. Return the absolute file path + first ~30 lines of the report
 */

import { z } from "zod";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { EdgeGateClient, EdgeGateError } from "../client.js";
import { VERSION } from "../version.js";
import type { GateEvalResult, RunBundle, RunComparison, RunDetail } from "../types.js";
import type { ToolResult } from "./setup_workspace.js";

export const exportRunReportInputSchema = z.object({
  workspace_id: z.string().uuid(),
  run_id: z.string().uuid(),
  output_path: z
    .string()
    .optional()
    .describe(
      "Where to write the markdown file. Defaults to `./edgegate-run-{id-short}.md` in the " +
        "current working directory. If a directory, the file is named `edgegate-run-{id-short}.md` " +
        "inside it. Supports `~` and relative paths."
    ),
  include_diff: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, also fetches the run-vs-baseline diff and appends a diff section to the report."
    ),
});

export type ExportRunReportInput = z.infer<typeof exportRunReportInputSchema>;

// Terminal statuses that should have a bundle available
const TERMINAL_STATUSES = new Set(["passed", "failed", "error"]);

export async function exportRunReportHandler(
  client: EdgeGateClient,
  input: ExportRunReportInput
): Promise<ToolResult> {
  try {
    const { workspace_id, run_id, output_path, include_diff } = input;

    // --- 1. Fetch run detail ---
    let run: RunDetail;
    try {
      run = await client.getRun(workspace_id, run_id);
    } catch (err) {
      if (err instanceof EdgeGateError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Could not fetch run ${run_id}: ${err.detail}`,
            },
          ],
        };
      }
      throw err;
    }

    // --- 2. Fetch evidence bundle (only for terminal runs) ---
    let bundle: RunBundle | null = null;
    if (TERMINAL_STATUSES.has(run.status)) {
      try {
        bundle = await client.getRunBundle(workspace_id, run_id);
      } catch (err) {
        if (err instanceof EdgeGateError && (err.status === 404 || err.status === 409)) {
          // Bundle not ready yet — proceed without it
          bundle = null;
        } else {
          throw err;
        }
      }
    }

    // --- 3. Optionally fetch diff ---
    let comparison: RunComparison | null = null;
    if (include_diff) {
      try {
        comparison = await client.getRunDiff(workspace_id, run_id);
      } catch (err) {
        if (err instanceof EdgeGateError && err.status === 404) {
          // No diff yet — silently omit the section
          comparison = null;
        } else if (err instanceof EdgeGateError) {
          // Non-fatal — skip the diff section but note it
          comparison = null;
        } else {
          throw err;
        }
      }
    }

    // --- 4. Render markdown ---
    const markdown = renderReport(run, bundle, comparison, workspace_id);

    // --- 5. Resolve output path ---
    const idShort = run_id.slice(0, 8);
    const defaultFilename = `edgegate-run-${idShort}.md`;
    const resolvedPath = await resolveOutputPath(output_path, defaultFilename);

    // Ensure parent directory exists
    const parent = resolvedPath.slice(0, resolvedPath.lastIndexOf("/"));
    if (parent) {
      await mkdir(parent, { recursive: true });
    }

    // --- 6. Write the file ---
    await writeFile(resolvedPath, markdown, "utf8");

    // --- 7. Return result ---
    const previewLines = markdown.split("\n").slice(0, 30).join("\n");
    const header = `Wrote run report to ${resolvedPath}\n\n`;
    return {
      content: [{ type: "text", text: header + previewLines }],
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

// ─── Path resolution ──────────────────────────────────────────────────────────

async function resolveOutputPath(
  outputPath: string | undefined,
  defaultFilename: string
): Promise<string> {
  if (!outputPath) {
    // Default: CWD / edgegate-run-{id-short}.md
    return join(process.cwd(), defaultFilename);
  }

  // Expand ~ to home dir
  let expanded = outputPath;
  if (expanded.startsWith("~/")) {
    expanded = join(homedir(), expanded.slice(2));
  } else if (expanded === "~") {
    expanded = homedir();
  }

  // Resolve relative to CWD
  const resolved = expanded.startsWith("/") ? expanded : join(process.cwd(), expanded);

  // Check if it's an existing directory
  try {
    const s = await stat(resolved);
    if (s.isDirectory()) {
      return join(resolved, defaultFilename);
    }
  } catch {
    // Doesn't exist yet — treat as file path
  }

  return resolved;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function statusBadge(status: string): string {
  const upper = status.toUpperCase();
  switch (upper) {
    case "PASSED":  return "**PASSED**";
    case "FAILED":  return "**FAILED**";
    case "RUNNING": return "_RUNNING_";
    case "PENDING": return "_PENDING_";
    case "ERROR":   return "**ERROR**";
    default:        return `_${upper}_`;
  }
}

function wallClock(run: RunDetail): string {
  if (!run.completed_at || !run.created_at) return "(pending)";
  const startMs = new Date(run.created_at).getTime();
  const endMs = new Date(run.completed_at).getTime();
  const totalS = Math.round((endMs - startMs) / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderReport(
  run: RunDetail,
  bundle: RunBundle | null,
  comparison: RunComparison | null,
  workspaceId: string
): string {
  const lines: string[] = [];

  // ── Header ──
  lines.push(`# EdgeGate Run Report`);
  lines.push(``);
  lines.push(`**Run ID:** \`${run.id}\``);
  lines.push(`**Pipeline:** ${run.pipeline_name} (\`${run.pipeline_id}\`)`);
  lines.push(`**Status:** ${statusBadge(run.status)}`);
  lines.push(`**Trigger:** ${run.trigger}`);
  lines.push(`**Created:** ${run.created_at}`);
  lines.push(`**Completed:** ${run.completed_at ?? "(in flight)"}`);
  lines.push(`**Wall clock:** ${wallClock(run)}`);
  lines.push(``);

  // ── Model ──
  if (run.model_artifact_id || run.hub_model_id || run.hub_job_id) {
    lines.push(`## Model`);
    if (run.model_artifact_id) lines.push(`- Artifact ID: \`${run.model_artifact_id}\``);
    if (run.model_filename)   lines.push(`- Filename: ${run.model_filename}`);
    if (run.hub_model_id)     lines.push(`- AI Hub model: \`${run.hub_model_id}\``);
    if (run.hub_job_id)       lines.push(`- AI Hub job: \`${run.hub_job_id}\``);
    lines.push(``);
  }

  // ── In-flight guard ──
  const isComplete = TERMINAL_STATUSES.has(run.status) && (bundle !== null || run.gates_eval !== null);
  if (!isComplete) {
    lines.push(`## Status`);
    lines.push(``);
    lines.push(`_Run not yet complete — check back._`);
    lines.push(``);
    if (run.error_code) {
      lines.push(`**Error code:** ${run.error_code}`);
      if (run.error_detail) lines.push(`**Error detail:** ${run.error_detail}`);
      lines.push(``);
    }
    appendFooter(lines);
    if (comparison) appendDiffSection(lines, comparison);
    return lines.join("\n");
  }

  // ── Metrics ──
  const metrics = bundle?.normalized_metrics ?? run.normalized_metrics;
  if (metrics && Object.keys(metrics).length > 0) {
    lines.push(`## Metrics`);
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    for (const [k, v] of Object.entries(metrics)) {
      lines.push(`| ${k} | ${v} |`);
    }
    lines.push(``);
  }

  // ── Gate Results ──
  // gates_eval can be {} without a `gates` array on runs that errored
  // before evaluation. `.gates.length` on undefined would crash the export
  // for any failed run. Guard before reading.
  const gatesEval = bundle?.gates_eval ?? run.gates_eval;
  if (gatesEval && Array.isArray(gatesEval.gates) && gatesEval.gates.length > 0) {
    lines.push(`## Gate Results`);
    lines.push(`| Metric | Operator | Threshold | Actual | Status |`);
    lines.push(`|---|---|---|---|---|`);
    for (const gate of gatesEval.gates) {
      lines.push(renderGateRow(gate));
    }
    lines.push(``);
    lines.push(
      `**Overall verdict:** ${gatesEval.passed ? "**PASSED**" : "**FAILED**"}`
    );
    lines.push(``);
  }

  // ── Error info ──
  if (run.error_code) {
    lines.push(`## Error`);
    lines.push(`- Code: ${run.error_code}`);
    if (run.error_detail) lines.push(`- Detail: ${run.error_detail}`);
    lines.push(``);
  }

  // ── Evidence Bundle ──
  const bundleArtifactId = bundle?.bundle_artifact_id ?? run.bundle_artifact_id;
  if (bundleArtifactId) {
    lines.push(`## Evidence Bundle`);
    lines.push(`- Bundle artifact ID: \`${bundleArtifactId}\``);
    lines.push(
      `- Download via API: \`GET /v1/workspaces/${workspaceId}/bundles/${bundleArtifactId}/artifact-url\`` +
        ` (returns short-lived signed URL)`
    );
    lines.push(``);
  }

  // ── Diff section ──
  if (comparison) {
    appendDiffSection(lines, comparison);
  }

  appendFooter(lines);
  return lines.join("\n");
}

function renderGateRow(gate: GateEvalResult): string {
  const statusIcon = gate.passed ? "✓ PASSED" : "✗ FAILED";
  return `| ${gate.metric} | ${gate.operator} | ${gate.threshold} | ${gate.actual_value} | ${statusIcon} |`;
}

function appendDiffSection(lines: string[], comparison: RunComparison): void {
  const diff = comparison.diff;
  lines.push(`## Run-vs-Baseline Diff`);
  lines.push(``);
  lines.push(
    `**Candidate:** \`${comparison.current_run_id}\`  ` +
      `(${diff.current_completed_at ?? "in flight"})`
  );
  lines.push(
    `**Baseline:** \`${comparison.previous_run_id ?? "—"}\`  ` +
      `(${diff.previous_completed_at ?? "—"})`
  );
  lines.push(``);

  if (diff.is_baseline) {
    lines.push(`> **NO BASELINE** — this is the first completed run in this pipeline.`);
    lines.push(``);
    return;
  }

  // Metrics
  const metricKeys = Object.keys(diff.metric_deltas).sort();
  if (metricKeys.length > 0) {
    lines.push(`### Metrics`);
    lines.push(`| Metric | Baseline | Candidate | Delta |`);
    lines.push(`|---|---|---|---|`);
    for (const k of metricKeys) {
      const m = diff.metric_deltas[k];
      const pct =
        m.delta_pct !== null
          ? `${m.delta_pct > 0 ? "+" : ""}${m.delta_pct.toFixed(1)}%`
          : "—";
      const delta = m.delta !== null ? `${m.delta > 0 ? "+" : ""}${m.delta.toFixed(2)} (${pct})` : "—";
      lines.push(
        `| ${k} | ${m.previous ?? "—"} | ${m.current ?? "—"} | ${delta} |`
      );
    }
    lines.push(``);
  }

  // Gate flips
  if (diff.gate_flips.length > 0) {
    lines.push(`### Gate Status`);
    lines.push(`| Gate | Baseline | Candidate | Transition |`);
    lines.push(`|---|---|---|---|`);
    for (const gf of diff.gate_flips) {
      const baseIcon = gf.previous?.passed === true ? "✓" : gf.previous?.passed === false ? "✗" : "—";
      const candIcon = gf.current?.passed === true ? "✓" : gf.current?.passed === false ? "✗" : "—";
      const label = gf.transition === "regressed" ? "**REGRESSION** ✓→✗"
        : gf.transition === "improved" ? "RECOVERY ✗→✓"
        : gf.transition;
      lines.push(`| ${gf.metric} | ${baseIcon} | ${candIcon} | ${label} |`);
    }
    lines.push(``);
  }

  // Audit
  if (comparison.diff_sha256) {
    lines.push(`**Diff SHA-256:** \`${comparison.diff_sha256}\` (signed, embedded in evidence bundle)`);
    lines.push(``);
  }
}

function appendFooter(lines: string[]): void {
  lines.push(`---`);
  lines.push(`_Generated by edgegate-mcp@${VERSION} on ${new Date().toISOString()}_`);
}

// Export the tmpdir helper so tests can use the same default resolution logic
export { tmpdir as _tmpdir };
