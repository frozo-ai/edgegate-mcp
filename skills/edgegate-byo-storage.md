---
name: edgegate-byo-storage
description: Wire up BYO (bring-your-own) S3 storage for an Enterprise EdgeGate workspace — register the IAM role + bucket grant, verify the readiness probe, register the first artifact directly from the customer's bucket, and confirm the audit trail. Use when the user is on the Enterprise plan and wants model bytes to live in their own AWS account.
---

# /edgegate-byo-storage

This is the **Enterprise BYO storage onboarding** flow. The whole point of
BYO is that model bytes never leave the customer's AWS account — EdgeGate's
workers AssumeRole into their account and read directly from their bucket.

Use this skill once per workspace, after the customer's security/IAM team
has provisioned the role + bucket.

## When to use

- The workspace is on the **Enterprise plan** (BYO storage 402s otherwise).
- The user has (or wants to provision) their own S3 bucket and IAM role.
- The user is migrating an existing workspace from EdgeGate-managed storage
  to BYO, or onboarding a brand-new Enterprise workspace.

If the workspace isn't Enterprise yet, send them to
<https://edgegate.frozo.ai/enterprise> first — none of the
`edgegate_*_byo_*` tools will work until BYO is enabled on the plan.

## Pre-flight (AWS side — the user does this in their account)

You can't do this part for them, but you can hand them the exact spec:

1. **Provision the IAM role.** The fastest path is the EdgeGate
   CloudFormation Launch Stack — link them to it from
   <https://edgegate.frozo.ai/workspace/{workspace_id}/settings#byo-storage>.
   (A Terraform module is also published; ask the customer which their
   security team prefers.) The stack creates:
   - The IAM role with `sts:AssumeRole` trusted to EdgeGate's AWS account.
   - The S3 bucket policy granting that role `s3:GetObject` + `ListBucket`
     scoped to the bucket only.
   - (Optional) KMS key policy granting `kms:Decrypt` if the bucket uses
     SSE-KMS.
2. **Capture** the `role_arn`, `bucket` name, `region`, and (if applicable)
   `kms_key_id`. The trust policy's `sts:ExternalId` is left as a
   placeholder — EdgeGate mints the real one in step 1 below and the
   customer pastes it back.

If they want the raw IAM JSON instead of CloudFormation/Terraform, point
them at `docs/byo-storage-onboarding.md` in the backend repo or the
dashboard's "Show raw policies" link.

## Steps

1. **Register the grant.** Call
   `edgegate_register_byo_bucket({ workspace_id, role_arn, bucket, region, kms_key_id? })`.
   The response includes an `external_id` UUID — capture it.

2. **Paste the External ID into the IAM role trust policy.** Tell the
   user, in plain English: "Open your IAM role in the AWS console, edit
   the trust relationship, and replace the placeholder ExternalId with
   `<external_id>`." Until they do this, AssumeRole will fail with
   `BYO_ASSUME_ROLE_FAILED`.

   The CloudFormation stack supports passing the External ID as a
   parameter — point them at that if they used the stack.

3. **Verify the probe.** After the user confirms the trust policy edit
   is saved, call `edgegate_check_byo_bucket({ workspace_id })`. Expect
   `status: "active"`. If `status: "failed"`, the response's checklist
   covers every typed `BYO_*` error code — read the `last_verify_error`
   to the user, suggest the matching fix, then re-run `check`.

4. **Register the first artifact.** Pick (or ask for) an existing model
   in the bucket. Call:
   ```
   edgegate_register_byo_artifact({
     workspace_id,
     s3_uri: "s3://<bucket>/<key>.onnx",
     expected_sha256: "<optional but recommended>",
   })
   ```
   Capture the returned `artifact_id`. EdgeGate did NOT download the
   bytes — it only HeadObject'd the URI to confirm the key exists and
   capture size + etag. The storage URL in the response will start with
   `byo-s3://` (not `s3://`) — that's how downstream tooling routes
   reads through the BYO service rather than EdgeGate's managed S3.

5. **Trigger the first run.** Run the artifact against an existing
   pipeline so the customer sees the end-to-end flow work:
   ```
   edgegate_run_gate({
     workspace_id,
     pipeline_id: "<existing pipeline>",
     model_artifact_id: "<artifact_id from step 4>",
   })
   ```
   Poll with `edgegate_check_status` until it terminates.

6. **Show them the audit trail.** Call
   `edgegate_get_byo_audit({ workspace_id, run_id: "<run_id from step 5>" })`.
   The table includes one row per S3 / STS call with the
   `aws_request_id`. Tell the user: "Cross-reference these against your
   own CloudTrail in the same time window — every read should match."
   This is the trust handshake the customer's security team will ask
   for.

7. **Recap + next.** Summarize:
   - Grant: `active`, bucket=`<name>`, region=`<region>`
   - First artifact registered + first run executed
   - Audit log accessible via `edgegate_get_byo_audit`

   Next concrete actions:
   - "Migrate more artifacts: `edgegate_register_byo_artifact` per s3_uri"
   - "Schedule periodic audit pulls into your SIEM (we can stream via API)"
   - "Rotate the External ID at any time via the dashboard"

## Failure modes

- **Register grant → 402.** Workspace is not on Enterprise. Send them to
  <https://edgegate.frozo.ai/enterprise>.
- **Register grant → 409.** A grant already exists. We deliberately do
  NOT auto-rotate — the existing grant may belong to a role the customer
  doesn't want overwritten. Inspect with `edgegate_check_byo_bucket`,
  then either keep it or `edgegate_disconnect_byo_bucket` and re-register.
  External-ID-only rotation is available via the dashboard.
- **Check probe → status=failed with BYO_ASSUME_ROLE_FAILED.** External
  ID drift between EdgeGate and the role's trust policy. Re-paste the
  current external_id (visible via `edgegate_check_byo_bucket` or the
  dashboard) into the trust policy's `sts:ExternalId` condition.
- **Check probe → BYO_KMS_ACCESS_DENIED.** SSE-KMS bucket but the role
  is missing `kms:Decrypt` on the key. Add the role principal to the
  KMS key policy.
- **Check probe → BYO_REGION_MISMATCH.** The bucket lives in a different
  region than the `region` you registered. Disconnect and re-register
  with the correct region.
- **Register artifact → 400 bucket mismatch.** The s3_uri points at a
  bucket that isn't this workspace's registered one. Cross-bucket
  pointers are forbidden — register the right bucket (or move the
  object).
- **Register artifact → 400 BYO_OBJECT_NOT_FOUND.** The key is mistyped
  or the role's bucket policy denies `ListBucket`/`GetObject` on that
  prefix. HeadObject failures pass through with the typed code.
- **Disconnect → 409.** Artifacts still reference the grant. The
  response lists the safe paths forward (drop the artifacts first, or
  rotate the External ID via dashboard if that's what you actually
  wanted).
- **Mid-run revocation** (customer revokes the role mid-run): the
  in-flight cells complete, the rest fail with
  `BYO_ASSUME_ROLE_FAILED`, the run terminates as `failed` (not
  `error`) with the partial-success cells preserved in the bundle.
  This is by design — re-grant + re-run picks up cleanly.
