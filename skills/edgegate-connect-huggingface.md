---
name: edgegate-connect-huggingface
description: Connect a personal HuggingFace token to the active workspace so EdgeGate can import private, gated, or Qualcomm-org repos. Walk the user through generating a token, confirming the account, and remembering that rotation is non-disruptive.
---

# /edgegate-connect-huggingface

Use this skill when the user wants to import a HuggingFace model that the
anonymous endpoint can't reach — common cases:

- `qualcomm/*` (Qualcomm's own optimized model org)
- `Intel/*` and many `Xenova/*` repos
- The user's own private repository
- Any gated model (Llama family, some image models, etc.) the user has access to

The workspace integration encrypts the token at rest using the same KMS as the
AI Hub token; it is never echoed in plaintext after the initial connect.

## Steps

1. **Confirm the active workspace.** If you don't already know which workspace
   the user is operating on, call `edgegate_setup_workspace` first.

2. **Check whether a token is already connected.** Call
   `edgegate_get_huggingface_integration`. If a token is already active,
   confirm with the user whether they want to **rotate** (replace) it before
   asking for a new one.

3. **Walk the user through generating a token** if they don't already have one.
   - Open <https://huggingface.co/settings/tokens>
   - Click **Create new token**
   - Default scope is `Read` — that's enough for the import flow
   - Copy the token. It starts with `hf_…` and is shown exactly once

4. **Call `edgegate_connect_huggingface`** with the token. The tool validates
   it against HF's `whoami` endpoint before storing, so a typo'd or revoked
   token surfaces as a clean 400 with guidance — not a silent failure later
   during import.

5. **Confirm.** The tool response includes the HF `account_name` and
   `account_type`. Confirm that matches the user's expectation — for example,
   if they meant to use their org account but the response shows their
   personal handle, offer to rotate with the right token.

6. **Move on.** Tell the user the integration is live and that they can now
   call `edgegate_import_huggingface_model` against any repo their token can
   read (including the Qualcomm org).

## Failure modes

- **400 "does not look like a HuggingFace token"** — they pasted something
  that doesn't start with `hf_` or `api_`. Direct them back to
  <https://huggingface.co/settings/tokens>.
- **400 "HuggingFace rejected the token"** — token is real-shaped but HF
  returned 401. Common causes: typo, copied truncated value, token revoked.
  Suggest regenerating.
- **409 conflict** — the tool auto-rotates on conflict, so this shouldn't
  bubble up. If it does, the rotation also failed; surface the error.

## Removing the integration

If the user wants to remove the token (offboarding, key rotation policy,
account change), call `edgegate_disconnect_huggingface`. The encrypted token
is deleted; future imports fall back to anonymous access.
