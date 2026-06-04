---
name: edgegate-audit
description: Fetch the signed audit PDF for a completed EdgeGate run. Use for compliance records or to attach to a release.
---

# /edgegate-audit

The user needs the audit PDF for a specific run (for SOC2, ISO, internal compliance, or to attach to a release).

1. If they gave you a `run_id`, call `edgegate_get_audit_report` directly.
2. If not, call `edgegate_get_report` and ask which run they want.
3. Return the signed URL. Remind the user that:
   - URLs are time-limited (~1h).
   - The PDF contains the signed evidence bundle hash, device fingerprints, and gate decisions.
   - Save it locally if they need a durable record.

If the run is still in-flight or the report hasn't generated yet, you'll get a 404. Tell the user to wait 1-2 minutes and retry.
