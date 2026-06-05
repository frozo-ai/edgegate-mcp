---
name: edgegate-export
description: Save an EdgeGate run report as a markdown file on disk. Use when the user wants to "export", "download", "save", or "share" a run report — e.g. for a PR comment, Slack message, or compliance record.
---

# /edgegate-export

The user wants the run report saved as a file they can share or attach.

## Steps

1. **Identify the run.** If they gave a `run_id`, use it. If not, call `edgegate_get_report` and ask which run.

2. **Pick the output path.**
   - If the user said "save to Downloads" or similar, use `~/Downloads`.
   - If they said "save next to my code" or didn't specify, default to the current working directory (the tool defaults to `./edgegate-run-{id-short}.md`).
   - If they said "save as <name>", use that exact filename.
   - The tool accepts directory paths (auto-appends a filename), file paths (used as-is), `~/` (expanded to home), and relative paths.

3. **Decide whether to include the diff.**
   - If the user mentioned "for the PR" or "vs main" or "with the comparison", pass `include_diff: true` — adds the run-vs-baseline diff section to the report.
   - Otherwise default `include_diff: false` — keeps the report focused on this run.

4. **Call `edgegate_export_run_report`** with the args.

5. **Confirm the file path** the tool returns and show the preview. Tell the user:
   - The file is ready to attach to a PR comment, paste into Slack, or store with compliance records.
   - If they want to also get a programmatic JSON version, point them at `edgegate_get_audit_report` for the bundle metadata.

## Failure modes

- **404 on the run** — wrong `run_id`. Check `edgegate_get_report`.
- **In-flight run** — the report omits gate results and bundle sections (they don't exist yet) but still writes a partial file noting the status. Tell the user to retry after the run completes.
- **Permission errors writing the file** — fall back to `/tmp/edgegate-run-{id}.md` and tell the user.
