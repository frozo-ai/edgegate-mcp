import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { connectQaihubHandler } from "../../src/tools/connect_qaihub.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_xxx";
const wsId = "00000000-0000-0000-0000-000000000001";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("connect_qaihub tool", () => {
  it("returns Connected message on first-time POST 201", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/integrations/qaihub`, () =>
        HttpResponse.json(
          {
            id: "int-1",
            provider: "qaihub",
            status: "active",
            token_last4: "abcd",
            created_at: "2026-06-06T00:00:00Z",
            updated_at: "2026-06-06T00:00:00Z",
          },
          { status: 201 },
        ),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await connectQaihubHandler(client, {
      workspace_id: wsId,
      token: "qai_token_value_1234",
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Connected");
    expect(result.content[0].text).toContain("****abcd");
  });

  it("auto-rotates on 409 conflict (POST → PUT /rotate)", async () => {
    let postCalled = false;
    let rotateCalled = false;

    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/integrations/qaihub`, () => {
        postCalled = true;
        return HttpResponse.json({ detail: "exists" }, { status: 409 });
      }),
      http.put(`${apiUrl}/v1/workspaces/${wsId}/integrations/qaihub/rotate`, () => {
        rotateCalled = true;
        return HttpResponse.json({
          id: "int-1",
          provider: "qaihub",
          status: "active",
          token_last4: "wxyz",
          created_at: "2026-06-06T00:00:00Z",
          updated_at: "2026-06-06T01:00:00Z",
        });
      }),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await connectQaihubHandler(client, {
      workspace_id: wsId,
      token: "qai_token_value_new",
    });

    expect(postCalled).toBe(true);
    expect(rotateCalled).toBe(true);
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Replaced");
    expect(result.content[0].text).toContain("****wxyz");
  });

  it("surfaces error when both POST and rotate fail", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/integrations/qaihub`, () =>
        HttpResponse.json({ detail: "exists" }, { status: 409 }),
      ),
      http.put(`${apiUrl}/v1/workspaces/${wsId}/integrations/qaihub/rotate`, () =>
        HttpResponse.json({ detail: "Qualcomm AI Hub rejected token" }, { status: 400 }),
      ),
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await connectQaihubHandler(client, {
      workspace_id: wsId,
      token: "qai_token_bogus",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("400");
  });
});
