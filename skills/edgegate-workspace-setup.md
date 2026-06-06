---
name: edgegate-workspace-setup
description: Bootstrap a new EdgeGate workspace end-to-end — create the workspace, connect Qualcomm AI Hub, mint an API key, and (optionally) invite teammates. Use this when the user has registered but hasn't yet set up a workspace, or wants a parallel one for a new project.
---

# /edgegate-workspace-setup

This is the **zero-to-runnable workspace** flow. It composes the other
single-purpose tools into a single guided onboarding sequence so the user can
go from "I just signed up" to "EdgeGate is running my model on a Snapdragon
device" without leaving the chat.

## When to use

- User just signed up at <https://edgegate.frozo.ai/register> and wants to
  start using the MCP
- User is creating a parallel workspace for a new project / customer / branch
- User says "set up EdgeGate for me", "create a new workspace and wire it up",
  or similar

If they already have a usable workspace and just need to connect AI Hub or
add members, send them to `/edgegate-connect-qaihub` or
`/edgegate-invite-member` directly instead.

## Steps

1. **Create the workspace.** Ask for a name (e.g. "MobileNet Production",
   "Customer Pilot — Bosch"). Call `edgegate_create_workspace({ name })` and
   capture the returned `workspace_id`. Pass that id to every subsequent call.

2. **Connect Qualcomm AI Hub.** Without this, runs will fail with
   `NO_AIHUB_TOKEN`. Either:
   - Run the `/edgegate-connect-qaihub` sub-flow, **or**
   - If the user has their AI Hub token at hand, call
     `edgegate_connect_qaihub({ workspace_id, token })` directly.

   Pause here until the integration is **active**.

3. **(Optional) Mint a CI API key.** If the user plans to wire EdgeGate into
   GitHub Actions / GitLab CI / similar, call `edgegate_create_api_key` with
   a descriptive name (e.g. "GitHub Actions — production"). **Tell them the
   plaintext is returned exactly once** and they MUST copy it now into their
   CI secrets manager. Re-show the value, then move on. If they want to
   actually wire the GitHub Action immediately, follow up with
   `edgegate_setup_github_action`.

4. **(Optional) Invite teammates.** If the user mentions teammates, run the
   `/edgegate-invite-member` sub-flow or call `edgegate_invite_member`
   directly per teammate. Roles: `owner` (full control, billing), `admin`
   (pipelines + runs, no billing or workspace delete), `viewer` (read-only).

5. **Confirm + suggest next.** Recap what's set up:
   - workspace name + id
   - AI Hub: connected (token `****xxxx`)
   - API keys: how many active
   - members: count + roles

   Then suggest the next concrete action:
   - "Import a model from HuggingFace: `edgegate_import_huggingface_model`"
   - "Create the first regression pipeline: `edgegate_create_pipeline`"

## Failure modes

- **Create workspace → 403 plan_limit_exceeded.** They've hit their plan's
  workspace cap. Direct them to <https://edgegate.frozo.ai/pricing> to
  upgrade, or to remove an unused workspace via the dashboard first.
- **Connect AI Hub → 401 from Hub.** The token they pasted is wrong or
  revoked. Send them back to
  <https://app.aihub.qualcomm.com/account/api-token> for a fresh one.
- **Create API key → 402.** Their plan doesn't include API access. Pro tier
  or above is required; direct them to pricing.
- **Invite member → 404.** The email doesn't belong to an existing EdgeGate
  account. v1 doesn't send invitation emails — the teammate has to register
  first at <https://edgegate.frozo.ai/register>.
