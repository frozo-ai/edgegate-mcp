import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import {
  publishPromptpackHandler,
  publishPromptpackInputSchema,
} from "../../src/tools/publish_promptpack.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const minimalInput = {
  workspace_id: wsId,
  promptpack_id: "text-embed-bench-v1",
  version: "1.0.0",
};

const publishedResponse = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  promptpack_id: "text-embed-bench-v1",
  version: "1.0.0",
  sha256: "aabbccdd11223344aabbccdd11223344",
  case_count: 5,
  published: true,
  created_at: "2026-06-05T14:53:11.012770Z",
};

// ─── 1. Happy path — 200 published ───────────────────────────────────────────

describe("happy path", () => {
  it("returns success markdown showing pack is published and usable in pipelines", async () => {
    server.use(
      http.put(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks/text-embed-bench-v1/1.0.0/publish`,
        () => HttpResponse.json(publishedResponse, { status: 200 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await publishPromptpackHandler(client, minimalInput);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("text-embed-bench-v1@1.0.0");
    expect(text).toContain("dddddddd-dddd-dddd-dddd-dddddddddddd");
    expect(text).toContain("5 case(s)");
    expect(text).toContain("published: true");
    expect(text).toContain("aabbccdd11223344aabbccdd11223344");
    expect(text).toMatch(/edgegate_create_pipeline/i);
  });
});

// ─── 2. 404 not found ────────────────────────────────────────────────────────

describe("404 not found", () => {
  it("returns isError=true with hint to list packs", async () => {
    server.use(
      http.put(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks/text-embed-bench-v1/1.0.0/publish`,
        () =>
          HttpResponse.json(
            { detail: "PromptPack not found." },
            { status: 404 }
          )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await publishPromptpackHandler(client, minimalInput);

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("text-embed-bench-v1@1.0.0");
    expect(text).toMatch(/not found/i);
    expect(text).toMatch(/edgegate_list_promptpacks/i);
  });
});

// ─── 3. 403 not admin ────────────────────────────────────────────────────────

describe("403 not admin", () => {
  it("returns isError=true with admin-role hint", async () => {
    server.use(
      http.put(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks/text-embed-bench-v1/1.0.0/publish`,
        () =>
          HttpResponse.json(
            { detail: "Admin role required." },
            { status: 403 }
          )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await publishPromptpackHandler(client, minimalInput);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/admin role/i);
  });
});

// ─── 4. Already published — idempotent (409 with "already published" detail) ─

describe("already published (idempotent)", () => {
  it("treats 409 already-published as non-error success", async () => {
    server.use(
      http.put(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks/text-embed-bench-v1/1.0.0/publish`,
        () =>
          HttpResponse.json(
            { detail: "PromptPack already published." },
            { status: 409 }
          )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await publishPromptpackHandler(client, minimalInput);

    // Should NOT be an error — idempotent success
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("text-embed-bench-v1@1.0.0");
    expect(text).toMatch(/already published/i);
    expect(text).toMatch(/edgegate_create_pipeline/i);
  });

  it("treats 200 response with published=true as success (normal already-published path)", async () => {
    server.use(
      http.put(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks/text-embed-bench-v1/1.0.0/publish`,
        () => HttpResponse.json(publishedResponse, { status: 200 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await publishPromptpackHandler(client, minimalInput);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("published: true");
  });
});

// ─── 5. Client-side zod validation ───────────────────────────────────────────

describe("client-side zod validation", () => {
  it("rejects version '1.0' (not full semver) before any network call", async () => {
    let putCallCount = 0;
    server.use(
      http.put(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks/text-embed-bench-v1/1.0/publish`,
        () => {
          putCallCount += 1;
          return HttpResponse.json(publishedResponse, { status: 200 });
        }
      )
    );

    const parsed = publishPromptpackInputSchema.safeParse({
      ...minimalInput,
      version: "1.0",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toMatch(/semver/i);
    }
    expect(putCallCount).toBe(0);
  });

  it("rejects promptpack_id with spaces", async () => {
    const parsed = publishPromptpackInputSchema.safeParse({
      ...minimalInput,
      promptpack_id: "invalid id",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toMatch(/\[a-zA-Z0-9_-\]/);
    }
  });
});
