---
name: edgegate-members
description: List, invite, change role of, or remove EdgeGate workspace members. Use for any "add Alice as admin", "show me who's on this workspace", "Bob left the team", or similar membership management.
---

# /edgegate-members

Composes the four member tools into a single skill the LLM can route any
membership-management request through.

## Roles

| Role | Can do | Can NOT do |
|---|---|---|
| `owner` | Everything: members, billing, delete workspace, AI Hub connect, pipelines, runs | (nothing — full power) |
| `admin` | Pipelines, runs, integrations, members (except adding owners) | Billing, delete workspace, downgrade self |
| `viewer` | Read pipelines, runs, reports, members | Anything write |

## Steps by intent

### "Show me the members" / "Who's on this workspace?"
Call `edgegate_list_members({ workspace_id })`. Returns email + role + user_id.

### "Add Alice as admin"
1. Call `edgegate_invite_member({ workspace_id, user_email, role })`.
2. If the response is 404, Alice doesn't have an EdgeGate account yet — tell
   the user Alice needs to register at <https://edgegate.frozo.ai/register>
   first, then re-run.
3. If 409, Alice is already a member — offer to update her role with
   `/edgegate-members → change role` instead.

### "Make Bob an owner" / "Downgrade Carol to viewer"
1. Get Bob's user_id from `edgegate_list_members` if not already known.
2. Call `edgegate_change_member_role({ workspace_id, user_id, role })`.
3. If the response is 400 with "Cannot remove the last owner", explain to
   the user: they need to promote another member to owner first, then come
   back to downgrade the original owner.

### "Remove Dave"
1. Get Dave's user_id.
2. Confirm with the user (this is destructive — Dave loses access
   immediately). Mention that Dave's pipelines and runs are preserved.
3. Call `edgegate_remove_member({ workspace_id, user_id })`.
4. Same last-owner guard as above applies.

## Failure modes

- **403** on invite / change / remove — the caller's own role is too low. The
  detail message names the required role.
- **404** on user lookup — the email or user_id doesn't exist in EdgeGate.
- **plan_limit_exceeded** on invite — workspace seat cap; direct to pricing.
