---
name: edgegate-connect-qaihub
description: Connect a Qualcomm AI Hub API token to the active EdgeGate workspace so runs can compile and profile models on real Snapdragon devices. Required before any pipeline can actually execute.
---

# /edgegate-connect-qaihub

Use this skill when the user is setting up a new EdgeGate workspace, has just
created one with `edgegate_create_workspace`, or is seeing runs fail with
`NO_AIHUB_TOKEN`.

Qualcomm AI Hub is the device cloud EdgeGate uses behind the scenes — every
compile + profile + inference job runs against a real Snapdragon device there.
Without a token connected, the worker can't talk to Hub, so runs that reach the
worker fail fast.

## Steps

1. **Confirm the active workspace.** If you don't already know which workspace,
   call `edgegate_setup_workspace` first.

2. **Check whether a token is already connected.** Call
   `edgegate_get_qaihub_integration`. If the response says **active** with a
   `token_last4`, ask the user whether they want to **rotate** (replace) the
   existing token before continuing. If the response is 404, they need to
   connect for the first time.

3. **Walk the user through generating a Qualcomm AI Hub token** if they don't
   already have one:
   - Open <https://app.aihub.qualcomm.com/account/api-token>
   - Click **Generate new token** (or copy the existing one if shown)
   - The token is a long alphanumeric string; copy it

4. **Call `edgegate_connect_qaihub`** with the token. The backend stores it
   under envelope encryption using the workspace KMS — the plaintext is
   never returned again, and only `token_last4` is visible afterwards.

5. **Confirm + next step.** Tell the user the integration is live. If this is
   their first connection, suggest:
   - `edgegate_create_promptpack` (if they need a new promptpack)
   - `edgegate_create_pipeline` to define their first regression gate

## Failure modes

- **Already exists (409 conflict)** — the tool transparently rotates instead
  of failing, so the user shouldn't see this. If it does bubble up, the
  rotation also failed and the backend error message comes through.
- **500 from Qualcomm AI Hub itself** — usually a transient outage at Hub
  (`https://app.aihub.qualcomm.com`). Ask the user to retry in a minute.

## Removing the integration

If the user wants to disconnect (offboarding, key rotation policy, account
change), call `edgegate_disconnect_qaihub`. The encrypted token is deleted
and new runs in the workspace fail with `NO_AIHUB_TOKEN` until a fresh
token is connected.
