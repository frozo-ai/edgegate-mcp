---
name: edgegate-promptpacks
description: List or create EdgeGate promptpacks. Use when the user says "list my promptpacks", "what packs do I have", "create a promptpack", "make a new pack", "I need a text embedding pack", or any variation on viewing or authoring test-case packs for EdgeGate pipelines.
---

# /edgegate-promptpacks

The user wants to list existing promptpacks in their workspace, or create a new one.

## Triggers

Use this skill when the user says any of:
- "list my promptpacks" / "what packs do I have" / "show my packs"
- "create a promptpack" / "make a new pack" / "add test cases"
- "I need a text embedding pack" / "create an LLM completion benchmark"
- "set up test cases for my image classification model"

## Decision tree

1. **Confirm workspace.** If you don't have a `workspace_id`, call `edgegate_setup_workspace` with no args and ask which workspace to use.

2. **List first if no specific pack mentioned.**
   - Call `edgegate_list_promptpacks({ workspace_id, include_unpublished: true })`
   - Show the user what already exists — they may be able to reuse an existing pack.

3. **If creating:**
   a. Ask the user what kind of model the pack is for if not clear:
      - Text/LLM completion (prompt → generated text)
      - Text embedding (prompt → vector; validation typically `type: "none"`)
      - Image classification (structured output; validate with `json_schema`)
   b. Suggest 3–5 sensible test cases based on use case (Claude can generate them — see templates below).
   c. Confirm `promptpack_id` (slug, no spaces), `version` (start at `1.0.0` unless user says otherwise), and `name`.
   d. Call `edgegate_create_promptpack(...)`.

## Case templates by model type

### Text embedding / similarity
```json
[
  { "case_id": "short-greeting",   "name": "Short greeting",     "prompt": "hello world",                         "expected": { "type": "none" } },
  { "case_id": "sentence-pair",    "name": "Sentence pair",      "prompt": "The quick brown fox jumps.",          "expected": { "type": "none" } },
  { "case_id": "long-paragraph",   "name": "Long paragraph",     "prompt": "Embeddings capture semantic meaning...", "expected": { "type": "none" } }
]
```

### LLM completion (exact or regex validation)
```json
[
  { "case_id": "capital-france",   "name": "Capital of France",  "prompt": "What is the capital of France?",      "expected": { "type": "exact",  "text": "Paris" } },
  { "case_id": "hello-response",   "name": "Hello response",     "prompt": "Say hello.",                          "expected": { "type": "regex",  "pattern": "(?i)hello" } },
  { "case_id": "add-numbers",      "name": "Add two numbers",    "prompt": "What is 3 + 4?",                      "expected": { "type": "exact",  "text": "7" } }
]
```

### Structured / JSON output
```json
[
  {
    "case_id": "classify-cat",
    "name": "Classify cat image description",
    "prompt": "Classify: a furry four-legged animal with whiskers.",
    "expected": {
      "type": "json_schema",
      "schema": { "type": "object", "properties": { "label": { "type": "string" } }, "required": ["label"] }
    }
  }
]
```

## Versioning rules

- Start at `1.0.0` unless the user specifies otherwise.
- Packs are **immutable** — to update, bump the patch (e.g. `1.0.0` → `1.0.1`) and create a new pack.
- Only published packs can be referenced in pipelines. Newly created packs are `published: false` — remind the user to publish via the dashboard.

## Failure modes

- **409 conflict** — (promptpack_id, version) already exists. Bump the version and retry.
- **403 forbidden** — user needs admin role on the workspace.
- **400 / schema error** — surface the `issues` array to the user; common causes are `case_id` with spaces or special characters, `max_new_tokens` > 256, or more than 50 cases.
