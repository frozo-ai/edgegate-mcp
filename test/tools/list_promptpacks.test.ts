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
import { listPromptpacksHandler } from "../../src/tools/list_promptpacks.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";

const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const packA = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  promptpack_id: "image-classification-bench-v1",
  version: "1.0.0",
  sha256: "9da81db4abcd1234",
  case_count: 4,
  published: true,
  created_at: "2026-04-27T11:22:23.638655Z",
};

const packB = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  promptpack_id: "person-detection-draft",
  version: "1.0.0",
  sha256: "deadbeef00001111",
  case_count: 2,
  published: false,
  created_at: "2026-05-10T09:00:00.000000Z",
};

// ─── 1. Empty workspace ───────────────────────────────────────────────────

describe("empty workspace", () => {
  it("returns a friendly no-packs message", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () => HttpResponse.json([], { status: 200 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await listPromptpacksHandler(client, {
      workspace_id: wsId,
      include_unpublished: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/no promptpacks yet/i);
    expect(result.content[0].text).toContain(wsId);
  });
});

// ─── 2. Two packs with mixed published state → table rendering ────────────

describe("two packs with mixed published state", () => {
  it("renders a markdown table with both packs", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () => HttpResponse.json([packA, packB], { status: 200 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await listPromptpacksHandler(client, {
      workspace_id: wsId,
      include_unpublished: true,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Found 2 promptpack(s)");
    expect(text).toContain("image-classification-bench-v1");
    expect(text).toContain("person-detection-draft");
    expect(text).toContain("| yes |");
    expect(text).toContain("| no |");
    expect(text).toContain("2026-04-27");
    expect(text).toMatch(/edgegate_create_pipeline/i);
  });
});

// ─── 3. include_unpublished=false hides draft packs ──────────────────────

describe("include_unpublished=false", () => {
  it("filters out unpublished packs client-side", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () => HttpResponse.json([packA, packB], { status: 200 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await listPromptpacksHandler(client, {
      workspace_id: wsId,
      include_unpublished: false,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Found 1 promptpack(s)");
    expect(text).toContain("image-classification-bench-v1");
    expect(text).not.toContain("person-detection-draft");
  });

  it("shows a hint about hidden packs when all are filtered out", async () => {
    server.use(
      http.get(
        `${apiUrl}/v1/workspaces/${wsId}/promptpacks`,
        () => HttpResponse.json([packB], { status: 200 })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await listPromptpacksHandler(client, {
      workspace_id: wsId,
      include_unpublished: false,
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toMatch(/no promptpacks yet/i);
    expect(text).toContain("unpublished");
  });
});
