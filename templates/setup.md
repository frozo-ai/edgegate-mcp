You have access to the EdgeGate MCP server (tools prefixed `edgegate_`).
EdgeGate runs AI model regression tests on real Snapdragon devices via
Qualcomm AI Hub and gates CI/CD pipelines with signed evidence bundles.

I want to set up an EdgeGate gate for the AI model in this repo. Please:

1. Call `edgegate_setup_workspace` and confirm which workspace I'm using.
2. Ask me which model file (artifact_id) to gate, which devices, and which
   thresholds. Sensible defaults: Galaxy S24 + S23,
   inference_time_ms ≤ 10, peak_memory_mb ≤ 150.
3. Call `edgegate_create_pipeline` with that config.
4. Trigger a first run with `edgegate_run_gate` and tell me the run_id.
5. Ask if I want to wire the GitHub Action. If yes, call
   `edgegate_setup_github_action` and show me the YAML + gh commands.

If you hit any 401, my EDGEGATE_API_KEY is bad — direct me to
https://edgegate.frozo.ai/workspace/<id>/settings#api-keys.
