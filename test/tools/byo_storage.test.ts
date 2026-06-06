import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { registerByoBucketHandler } from "../../src/tools/register_byo_bucket.js";
import { checkByoBucketHandler } from "../../src/tools/check_byo_bucket.js";
import { disconnectByoBucketHandler } from "../../src/tools/disconnect_byo_bucket.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_xxx";
const wsId = "00000000-0000-0000-0000-000000000001";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const sampleGrant = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  workspace_id: wsId,
  role_arn: "arn:aws:iam::123456789012:role/edgegate-byo-storage-prod",
  external_id: "22222222-2222-2222-2222-222222222222",
  bucket: "my-edgegate-models",
  region: "us-east-1",
  kms_key_id: null,
  status: "active",
  last_verified_at: "2026-06-06T00:00:00Z",
  last_verify_error: null,
  created_at: "2026-06-06T00:00:00Z",
  updated_at: "2026-06-06T00:00:00Z",
  ...overrides,
});

const validInput = {
  workspace_id: wsId,
  role_arn: "arn:aws:iam::123456789012:role/edgegate-byo-storage-prod",
  bucket: "my-edgegate-models",
  region: "us-east-1",
};

describe("register_byo_bucket tool", () => {
  it("renders friendly success card with External ID + bucket on 201", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`, () =>
        HttpResponse.json(sampleGrant(), { status: 201 }),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await registerByoBucketHandler(client, validInput);

    expect(result.isError).not.toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("Registered BYO storage grant");
    // External ID surfaced — that's the value the customer has to paste into trust policy.
    expect(text).toContain("22222222-2222-2222-2222-222222222222");
    // Bucket + region echoed back for confirmation.
    expect(text).toContain("my-edgegate-models");
    expect(text).toContain("us-east-1");
    // Role rendered with friendly tail (account last-4 + role name).
    expect(text).toContain("edgegate-byo-storage-prod");
    expect(text).toContain("acct …9012");
    // Trust-policy action item is mentioned.
    expect(text).toContain("trust policy");
  });

  it("surfaces 409 without auto-rotating; tells user to disconnect or rotate via dashboard", async () => {
    let rotateCalled = false;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`, () =>
        HttpResponse.json({ detail: "grant exists" }, { status: 409 }),
      ),
      // If we DID auto-rotate, this would be hit. We assert it is NOT.
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants/:id/rotate-external-id`,
        () => {
          rotateCalled = true;
          return HttpResponse.json(sampleGrant());
        },
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await registerByoBucketHandler(client, validInput);

    expect(rotateCalled).toBe(false);
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("already has a BYO storage grant");
    expect(text).toContain("edgegate_disconnect_byo_bucket");
    expect(text).toContain("edgegate_check_byo_bucket");
    // Dashboard link for External-ID-only rotation
    expect(text).toContain("dashboard");
  });

  it("surfaces 402 with Enterprise upgrade nudge", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`, () =>
        HttpResponse.json(
          { detail: "BYO storage requires the Enterprise plan." },
          { status: 402 },
        ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await registerByoBucketHandler(client, validInput);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Enterprise plan");
    expect(result.content[0].text).toContain("edgegate.frozo.ai/enterprise");
  });
});

describe("check_byo_bucket tool", () => {
  it("renders success when probe passes (status=active)", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants/verify`,
        () => HttpResponse.json(sampleGrant({ status: "active" })),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkByoBucketHandler(client, { workspace_id: wsId });

    expect(result.isError).not.toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("**active**");
    expect(text).toContain("Probe passed");
    expect(text).toContain("edgegate_register_byo_artifact");
  });

  it("renders typed BYO_* error code + fix checklist when probe fails", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants/verify`,
        () =>
          HttpResponse.json(
            sampleGrant({
              status: "failed",
              last_verify_error:
                "BYO_ASSUME_ROLE_FAILED: External ID does not match trust policy",
            }),
          ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkByoBucketHandler(client, { workspace_id: wsId });

    expect(result.isError).not.toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("**failed**");
    expect(text).toContain("BYO_ASSUME_ROLE_FAILED");
    expect(text).toContain("External ID");
    expect(text).toContain("BYO_KMS_ACCESS_DENIED");
  });

  it("returns helpful message when no grant exists (404)", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants/verify`,
        () => HttpResponse.json({ detail: "no grant" }, { status: 404 }),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await checkByoBucketHandler(client, { workspace_id: wsId });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("No BYO storage grant");
    expect(result.content[0].text).toContain("edgegate_register_byo_bucket");
  });
});

describe("disconnect_byo_bucket tool", () => {
  it("renders success on 204 delete", async () => {
    server.use(
      http.delete(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await disconnectByoBucketHandler(client, { workspace_id: wsId });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Removed the BYO storage grant");
  });

  it("surfaces 409-with-artifacts with guidance to drop them first or rotate via dashboard", async () => {
    server.use(
      http.delete(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () =>
          HttpResponse.json(
            {
              detail:
                "Cannot delete grant: 3 artifacts still reference byo-s3://my-edgegate-models",
            },
            { status: 409 },
          ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await disconnectByoBucketHandler(client, { workspace_id: wsId });

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("artifacts still reference");
    expect(text).toContain("dashboard");
    expect(text).toContain("rotate");
    // The raw detail from the backend is shown verbatim for debugging.
    expect(text).toContain("3 artifacts");
  });

  it("returns benign 'nothing to disconnect' on 404", async () => {
    server.use(
      http.delete(
        `${apiUrl}/v1/workspaces/${wsId}/byo-storage/grants`,
        () => HttpResponse.json({ detail: "no grant" }, { status: 404 }),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await disconnectByoBucketHandler(client, { workspace_id: wsId });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("nothing to disconnect");
  });
});
