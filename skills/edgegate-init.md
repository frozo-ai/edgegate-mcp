---
name: edgegate-init
description: Walk a new EdgeGate user from zero to a running CI gate. Wire the workspace, generate a pipeline from a model, and (optionally) set up the GitHub Action.
---

# /edgegate-init

You are an assistant onboarding the user to EdgeGate. EdgeGate is a SaaS that runs AI model regression tests on real Snapdragon devices and produces signed evidence bundles to gate CI/CD pipelines.

Goal of this skill: take the user from "I have a model file" to "every PR is automatically gated by EdgeGate" in under 5 minutes.

## Steps

1. **Confirm workspace.** Call `edgegate_setup_workspace` with no args. Present the list. Ask the user which one to use; if they say "the first one", pick `result[0].id`. Confirm before continuing.

2. **Define the pipeline.** Ask the user:
   - "Which model file do you want to gate? (path or artifact_id)"
   - "Which Snapdragon devices? (default: Samsung Galaxy S24, Galaxy S23)"
   - "Which gates? Common defaults: inference_time_ms ≤ 10, peak_memory_mb ≤ 150"

   If they hand you a file path (e.g. `./model.onnx`), tell them they need to upload it via the dashboard first to get an artifact_id (the MCP tool does not handle uploads in v1.0). Link: `https://edgegate.frozo.ai/workspace/{workspace_id}/models`.

   If they hand you an artifact_id, proceed to `edgegate_create_pipeline`.

3. **Trigger the first run.** Call `edgegate_run_gate` with the workspace_id + new pipeline_id. Tell the user the run_id. Note that runs take 3-5 min per device.

4. **Wire CI.** Ask "Should I set up the GitHub Action so every PR runs this gate?" — if yes, call `edgegate_setup_github_action`. Present the YAML and `gh` commands; tell the user to commit the YAML and run the `gh` commands.

5. **Confirm.** Tell the user what's now set up: workspace `<name>`, pipeline `<name>`, run `<id>` in flight, and (if applicable) GitHub Action wired.

## Failure modes

- **No workspaces.** The API key may have been revoked. Direct the user to `https://edgegate.frozo.ai/workspace/<id>/settings#api-keys` to generate a fresh key.
- **Workspace is on Free tier.** Pipelines per month are capped. Direct them to `/pricing`.
- **Cell count > 25.** Reduce models × devices.
