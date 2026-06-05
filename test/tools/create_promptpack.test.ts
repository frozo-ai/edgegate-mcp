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
  createPromptpackHandler,
  createPromptpackInputSchema,
} from "../../src/tools/create_promptpack.js";

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
  promptpack_id: "my-text-embed-bench",
  version: "1.0.0",
  name: "MiniLM text embedding bench",
  cases: [
    {
      case_id: "short-greeting",
      name: "Short greeting",
      prompt: "hello world",
      expected: { type: "none" as const },
    },
  ],
};

const createdResponse = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  promptpack_id: "my-text-embed-bench",
  version: "1.0.0",
  sha256: "aabbccdd11223344",
  case_count: 1,
  published: false,
  created_at: "2026-06-05T15:00:00Z",
};

// ─── 1. Happy path — 201 success ─────────────────────────────────────────

describe("happy path", () => {
  it("returns success markdown with uuid and pipeline snippet", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () => HttpResponse.json(createdResponse, { status: 201 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPromptpackHandler(client, minimalInput);

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("my-text-embed-bench@1.0.0");
    expect(text).toContain("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(text).toContain("1 case(s)");
    expect(text).toContain("published: false");
    expect(text).toContain("aabbccdd11223344");
    expect(text).toMatch(/edgegate_create_pipeline/i);
  });
});

// ─── 2. Server returns 400 with issues array ──────────────────────────────

describe("400 validation error", () => {
  it("returns isError=true with issues surfaced", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () =>
          HttpResponse.json(
            {
              detail: JSON.stringify({
                issues: [
                  { path: ["cases", 0, "prompt"], message: "Prompt too long" },
                ],
              }),
            },
            { status: 400 }
          )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPromptpackHandler(client, minimalInput);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/400/);
    expect(result.content[0].text).toContain("Prompt too long");
  });
});

// ─── 3. Server returns 409 conflict ──────────────────────────────────────

describe("409 conflict", () => {
  it("returns isError=true with bump-version hint", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () =>
          HttpResponse.json(
            { detail: "PromptPack with this id and version already exists." },
            { status: 409 }
          )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPromptpackHandler(client, minimalInput);

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toMatch(/already exists/i);
    expect(text).toMatch(/immutable/i);
    // Should suggest bumped version 1.0.1
    expect(text).toContain("1.0.1");
  });
});

// ─── 4. Server returns 403 not admin ─────────────────────────────────────

describe("403 not admin", () => {
  it("returns isError=true with admin-role hint", async () => {
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () =>
          HttpResponse.json(
            { detail: "Admin role required." },
            { status: 403 }
          )
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPromptpackHandler(client, minimalInput);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/admin role/i);
  });
});

// ─── 5. Client-side zod rejects invalid promptpack_id ────────────────────

describe("invalid promptpack_id client-side validation", () => {
  it("rejects promptpack_id with slash before network call", async () => {
    let postCallCount = 0;
    server.use(
      http.post(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () => {
          postCallCount += 1;
          return HttpResponse.json(createdResponse, { status: 201 });
        }
      )
    );

    const parsed = createPromptpackInputSchema.safeParse({
      ...minimalInput,
      promptpack_id: "invalid/id",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toMatch(/\[a-zA-Z0-9_-\]/);
    }
    expect(postCallCount).toBe(0);
  });

  it("rejects a version that is not semver", async () => {
    const parsed = createPromptpackInputSchema.safeParse({
      ...minimalInput,
      version: "v1",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toMatch(/semver/i);
    }
  });

  it("rejects cases array with 0 entries", async () => {
    const parsed = createPromptpackInputSchema.safeParse({
      ...minimalInput,
      cases: [],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toMatch(/at least one case/i);
    }
  });
});
