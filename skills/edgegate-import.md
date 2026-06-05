---
name: edgegate-import
description: Import a public Hugging Face model (ONNX) into EdgeGate. Use when the user says "import model from huggingface", "pull this HF model", or references an "<owner>/<name>" repo they want to gate.
---

# /edgegate-import

The user wants to import a model from Hugging Face into EdgeGate so it can be used in a regression pipeline.

## Triggers

Use this skill when the user says any of:
- "import the microsoft/resnet-50 model from Hugging Face"
- "pull this HF model: owner/name"
- "I have a model on HuggingFace at owner/name"
- "use owner/name from HF for my gate"

## Steps

1. **Confirm workspace.** If you don't have a `workspace_id`, call `edgegate_setup_workspace` with no args and ask the user which workspace to use.

2. **Identify the repo.** The repo id must be `"<owner>/<name>"` (e.g. `"microsoft/resnet-50"`). If the user gives a full URL like `https://huggingface.co/owner/name`, extract just `owner/name`. Ask if unclear.

3. **Optional: revision and filename.** If the user doesn't mention a specific branch/tag, omit `revision` (defaults to `"main"`). If they don't mention a specific file, omit `filename` (EdgeGate will autodetect the ONNX file).

4. **Call the tool.** Default to `poll_for_completion: true` so the import finishes before you continue. Use `poll_for_completion: false` only if the user explicitly says they want to kick it off and come back later.

   ```
   edgegate_import_huggingface_model({
     workspace_id: "<id>",
     hf_repo_id: "microsoft/resnet-50",
     revision: "main",          // omit to use default
     filename: "model.onnx",    // omit to autodetect
     poll_for_completion: true,
   })
   ```

5. **On success.** The tool returns the `artifact_id`. Tell the user:
   - The model has been imported and is registered as an artifact.
   - They can now create a pipeline with it using `edgegate_create_pipeline` and pass `artifact_id` in the `models` array.
   - Offer to set up the pipeline immediately if they give you their target devices and gates.

6. **On timeout.** The import is still running in the background. Ask the user to run `/edgegate-import` again in a minute — the tool will resume polling.

## Failure modes

- **"no ONNX file found"** — The repo doesn't contain a pre-built ONNX. EdgeGate v1 only supports repos with a pre-built ONNX file. Point the user to the dashboard upload flow for converting their own model: `https://edgegate.frozo.ai/workspace/<id>/models`.
- **"private repo"** — EdgeGate v1 only imports public HuggingFace repos. Ask the user to make the repo public or use the direct upload flow instead.
- **402 — plan limit** — Direct the user to `https://edgegate.frozo.ai/pricing` to upgrade.
