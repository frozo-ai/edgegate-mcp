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

   If they hand you a HuggingFace repo id (e.g. `microsoft/resnet-50`), call `edgegate_import_huggingface_model` to import it and get an artifact_id back. If the repo is private / gated / from the Qualcomm org, the import will 401 — offer to run `/edgegate-connect-huggingface` to attach a personal HF token to the workspace, then retry the import.

   If they hand you an artifact_id, proceed to `edgegate_create_pipeline`.

3. **Trigger the first run.** Call `edgegate_run_gate` with the workspace_id + new pipeline_id. Tell the user the run_id. Note that runs take 3-5 min per device.

4. **Wire CI.** Ask "Should I set up the GitHub Action so every PR runs this gate?" — if yes, call `edgegate_setup_github_action`. Present the YAML and `gh` commands; tell the user to commit the YAML and run the `gh` commands.

5. **Confirm.** Tell the user what's now set up: workspace `<name>`, pipeline `<name>`, run `<id>` in flight, and (if applicable) GitHub Action wired.

## Input shape overrides (`input_specs`)

If creating a pipeline for a text or audio model, the backend auto-resolves dynamic shapes
(defaults: batch=1, sequence=128). If those defaults don't fit — long-context LLM, custom
audio model, or mixed-input model — pass `input_specs` explicitly with the right shape per input.

Examples:
- Long-context BERT (seq_len=512): `{ input_ids: { shape: [1, 512], dtype: "int64" }, attention_mask: { shape: [1, 512], dtype: "int64" } }`
- Audio model (mel-spectrogram): `{ mel_features: { shape: [1, 80, 3000], dtype: "float32" } }`
- Image model: omit entirely — the backend reads static shapes from the ONNX file.

## Failure modes

- **No workspaces.** The API key may have been revoked. Direct the user to `https://edgegate.frozo.ai/workspace/<id>/settings#api-keys` to generate a fresh key.
- **Workspace is on Free tier.** Pipelines per month are capped. Direct them to `/pricing`.
- **Cell count > 25.** Reduce models × devices.
