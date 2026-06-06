# edgegate-mcp

MCP server for [EdgeGate](https://edgegate.frozo.ai) — set up edge-AI regression gates on Snapdragon devices directly from Claude Code, Cursor, or Claude Desktop.

## What does it do?

EdgeGate runs AI model regression tests on real Snapdragon hardware via Qualcomm AI Hub, then produces signed evidence bundles you can attach to CI gates. This npm package exposes EdgeGate's REST API as 13 MCP tools, plus bundled skills, so you can drive the whole flow from a prompt:

```
> Use the edgegate MCP to set up a CI gate for my MobileNet ONNX model.
> Gates: inference_time_ms ≤ 10, peak_memory_mb ≤ 150.
> Devices: Galaxy S24, Galaxy S23.
```

## Install

```bash
# 1. Generate an API key in the EdgeGate dashboard
# https://edgegate.frozo.ai/workspace/<id>/settings#api-keys

# 2. Run the installer (writes config for Claude Code / Cursor / Desktop)
npx edgegate-mcp-install
```

Restart your MCP client. Done.

## Manual config

If you'd rather edit config files yourself, the server is a standard stdio MCP. Add this to your client's config:

### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "edgegate": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "edgegate-mcp"],
      "env": {
        "EDGEGATE_API_KEY": "egk_live_...",
        "EDGEGATE_API_URL": "https://edgegateapi.frozo.ai"
      }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

Same shape as Claude Code without the `type` field.

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)

Same shape as Cursor.

## Tools

See [docs/tools.md](./docs/tools.md) for the full tool reference. Quick list:

| Tool | Purpose |
|---|---|
| `edgegate_setup_workspace` | Pick / confirm the active workspace |
| `edgegate_create_pipeline` | Define a new regression pipeline |
| `edgegate_run_gate` | Trigger a run |
| `edgegate_check_status` | Poll a run for status + metrics |
| `edgegate_get_report` | List recent runs |
| `edgegate_get_audit_report` | Fetch the signed audit PDF |
| `edgegate_setup_github_action` | Generate the GitHub Actions workflow + secret commands |
| `edgegate_compare_runs` | Diff two runs — gate flips, metric deltas, per-device breakdown, REGRESSION / IMPROVEMENT / NEUTRAL verdict |
| `edgegate_export_run_report` | Save a complete run report as a markdown file to disk (returns the file path + preview) |
| `edgegate_import_huggingface_model` | Import a HuggingFace ONNX model — returns artifact_id ready for `edgegate_create_pipeline`. Uses the workspace's personal HF token when connected; otherwise anonymous |
| `edgegate_connect_huggingface` | Store a personal HuggingFace token in the workspace so imports can read private / gated / Qualcomm-org repos. Validated against HF whoami before encryption |
| `edgegate_get_huggingface_integration` | Show whether a HF token is currently connected (no plaintext) |
| `edgegate_disconnect_huggingface` | Delete the HF integration; future imports fall back to anonymous access |
| `edgegate_connect_qaihub` | Connect / rotate a Qualcomm AI Hub token (encrypted at rest, never returned in plaintext) |
| `edgegate_get_qaihub_integration` | Show the connection status of the workspace's AI Hub token |
| `edgegate_disconnect_qaihub` | Permanently delete the AI Hub integration |
| `edgegate_create_workspace` | Create a new workspace (caller becomes owner) |
| `edgegate_list_api_keys` | List API keys in the workspace (no plaintext) |
| `edgegate_create_api_key` | Mint a new API key — plaintext returned exactly once |
| `edgegate_revoke_api_key` | Revoke an API key by id (audit row preserved) |
| `edgegate_list_members` | List members + roles |
| `edgegate_invite_member` | Add an existing EdgeGate user to the workspace at a given role |
| `edgegate_change_member_role` | Change a member's role (cannot downgrade the last owner) |
| `edgegate_remove_member` | Remove a member (their pipelines/runs are preserved) |
| `edgegate_list_promptpacks` | List all promptpacks in a workspace (id, version, case count, published status) |
| `edgegate_create_promptpack` | Create a new promptpack with test cases (prompts, expected outputs, per-case overrides) |
| `edgegate_publish_promptpack` | Publish a promptpack version so it is usable in pipelines (completes the create → publish → use lifecycle) |

## Skills

Slash commands you can invoke directly:

- `/edgegate-init` — full onboarding flow (zero → CI gate)
- `/edgegate-gate` — trigger a run on an existing pipeline
- `/edgegate-status` — check a run's status + metrics
- `/edgegate-audit` — fetch the evidence bundle for a run
- `/edgegate-compare` — diff two runs (auto-baseline) with REGRESSION/IMPROVEMENT/NEUTRAL verdict
- `/edgegate-export` — save a run report as a markdown file (for PR comments, Slack, compliance)
- `/edgegate-import` — import a Hugging Face ONNX model (anonymous, or workspace-token for private / gated / qualcomm-org repos)
- `/edgegate-connect-huggingface` — attach a personal HuggingFace token to the workspace so the import flow can read private / gated / qualcomm-org repos
- `/edgegate-connect-qaihub` — connect a Qualcomm AI Hub token so runs can actually compile and profile on Snapdragon devices
- `/edgegate-workspace-setup` — bootstrap a brand-new workspace end-to-end (create → connect AI Hub → API key → invite teammates)
- `/edgegate-members` — list / invite / change role / remove workspace members
- `/edgegate-promptpacks` — list existing promptpacks or create a new one with generated test cases

## License

MIT — see [LICENSE](./LICENSE).
