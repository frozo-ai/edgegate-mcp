import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { setupByoStorageHandler } from "../../src/tools/setup_byo_storage.js";
import { attachByoRoleHandler } from "../../src/tools/attach_byo_role.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_xxx";
const wsId = "00000000-0000-0000-0000-000000000001";
const externalId = "22222222-2222-2222-2222-222222222222";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const setupInfoBody = (overrides: Record<string, unknown> = {}) => ({
  edgegate_aws_account_id: "054211127585",
  edgegate_principal_arn: "arn:aws:iam::054211127585:user/edgegate-worker",
  docs_url: "https://edgegate.frozo.ai/docs/byo-storage",
  trust_policy_template: "{}",
  permission_policy_template: "{}",
  permission_policy_with_kms_template: "{}",
  cloudformation_template_url: "",
  cloudformation_template_yaml: "AWSTemplateFormatVersion: '2010-09-09'",
  terraform_template: "",
  terraform_template_with_kms: "",
  setup_info_warning: null,
  ...overrides,
});

const pendingGrantBody = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  workspace_id: wsId,
  role_arn: null,
  external_id: externalId,
  bucket: "my-models",
  region: "us-east-1",
  kms_key_id: null,
  status: "pending_role",
  last_verified_at: null,
  last_verify_error: null,
  created_at: "2026-06-09T00:00:00Z",
  updated_at: "2026-06-09T00:00:00Z",
  ...overrides,
});

describe("setup_byo_storage tool", () => {
  it("registers pending grant and returns AWS CLI commands with embedded External ID", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/setup-info`,
        () => HttpResponse.json(setupInfoBody()),
      ),
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () => HttpResponse.json(pendingGrantBody(), { status: 201 }),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await setupByoStorageHandler(client, {
      workspace_id: wsId,
      bucket: "my-models",
      region: "us-east-1",
    });

    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    // Trust policy must reference the EdgeGate principal AND the External ID.
    expect(text).toContain("054211127585:user/edgegate-worker");
    expect(text).toContain(externalId);
    // Permission policy must lock to the bucket name + read-only actions.
    expect(text).toContain("s3:GetObject");
    expect(text).toContain("s3:HeadObject");
    expect(text).toContain("arn:aws:s3:::my-models/*");
    // AWS CLI commands must include create-role, put-role-policy, get-role.
    expect(text).toContain("aws iam create-role");
    expect(text).toContain("aws iam put-role-policy");
    expect(text).toContain("aws iam get-role");
    // Hand-off instruction must name the follow-up tool.
    expect(text).toContain("edgegate_attach_byo_role");
    // Suggested role name uses the external_id prefix the CFN template would use.
    expect(text).toContain(`edgegate-byo-read-${externalId.slice(0, 8)}`);
  });

  it("adds kms:Decrypt to permission policy when kms_key_id provided", async () => {
    const kmsArn = "arn:aws:kms:us-east-1:111111111111:key/abcd-1234";
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/setup-info`,
        () => HttpResponse.json(setupInfoBody()),
      ),
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () => HttpResponse.json(pendingGrantBody({ kms_key_id: kmsArn }), { status: 201 }),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await setupByoStorageHandler(client, {
      workspace_id: wsId,
      bucket: "my-models",
      region: "us-east-1",
      kms_key_id: kmsArn,
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("kms:Decrypt");
    expect(res.content[0].text).toContain(kmsArn);
  });

  it("re-uses existing pending grant on 409", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/setup-info`,
        () => HttpResponse.json(setupInfoBody()),
      ),
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () =>
          HttpResponse.json(
            { detail: "Workspace already has a BYO grant. Delete it first." },
            { status: 409 },
          ),
      ),
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () => HttpResponse.json(pendingGrantBody()),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await setupByoStorageHandler(client, {
      workspace_id: wsId,
      bucket: "my-models",
      region: "us-east-1",
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain(externalId);
  });

  it("refuses to overwrite an existing active grant on 409", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/setup-info`,
        () => HttpResponse.json(setupInfoBody()),
      ),
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () =>
          HttpResponse.json(
            { detail: "Workspace already has a BYO grant. Delete it first." },
            { status: 409 },
          ),
      ),
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () =>
          HttpResponse.json(
            pendingGrantBody({
              status: "active",
              role_arn: "arn:aws:iam::123:role/existing",
            }),
          ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await setupByoStorageHandler(client, {
      workspace_id: wsId,
      bucket: "my-models",
      region: "us-east-1",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("active");
    expect(res.content[0].text).toContain("edgegate_disconnect_byo_bucket");
  });

  it("surfaces operator-side misconfig when EdgeGate account ID isn't set", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/setup-info`,
        () =>
          HttpResponse.json(
            setupInfoBody({
              edgegate_aws_account_id: "<EDGEGATE_ACCOUNT_ID>",
              edgegate_principal_arn:
                "arn:aws:iam::<EDGEGATE_ACCOUNT_ID>:user/edgegate-worker",
            }),
          ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await setupByoStorageHandler(client, {
      workspace_id: wsId,
      bucket: "my-models",
      region: "us-east-1",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("BYO_EDGEGATE_AWS_ACCOUNT_ID");
  });
});

describe("attach_byo_role tool", () => {
  it("flips grant to active on probe success", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants/attach-role`,
        () =>
          HttpResponse.json(
            pendingGrantBody({
              status: "active",
              role_arn: "arn:aws:iam::123456789012:role/edgegate-byo-read-22222222",
              last_verified_at: "2026-06-09T00:00:00Z",
            }),
          ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await attachByoRoleHandler(client, {
      workspace_id: wsId,
      role_arn: "arn:aws:iam::123456789012:role/edgegate-byo-read-22222222",
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("active");
    expect(res.content[0].text).toContain("edgegate_register_byo_artifact");
  });

  it("surfaces failed probe with recovery checklist", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants/attach-role`,
        () =>
          HttpResponse.json(
            pendingGrantBody({
              status: "failed",
              role_arn: "arn:aws:iam::123456789012:role/edgegate-byo-read-22222222",
              last_verify_error: "BYO_ASSUME_ROLE_FAILED",
            }),
          ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await attachByoRoleHandler(client, {
      workspace_id: wsId,
      role_arn: "arn:aws:iam::123456789012:role/edgegate-byo-read-22222222",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("BYO_ASSUME_ROLE_FAILED");
    expect(res.content[0].text).toContain("External ID");
  });

  it("returns clear message when no pending grant exists", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants/attach-role`,
        () =>
          HttpResponse.json(
            { detail: "No BYO grant registered for this workspace." },
            { status: 404 },
          ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const res = await attachByoRoleHandler(client, {
      workspace_id: wsId,
      role_arn: "arn:aws:iam::123456789012:role/edgegate-byo-read-22222222",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("edgegate_setup_byo_storage");
  });
});
