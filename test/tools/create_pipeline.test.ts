import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { createPipelineHandler } from "../../src/tools/create_pipeline.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

describe("create_pipeline tool", () => {
  it("creates a pipeline with one model, two devices, one gate", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/pipelines`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            id: "p1",
            workspace_id: wsId,
            name: "MobileNet Gates",
            description: null,
            status: "active",
            pipeline_yaml: "name: MobileNet Gates\n",
            created_at: "2026-06-04T18:00:00Z",
          },
          { status: 201 }
        );
      })
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "MobileNet Gates",
      models: [{ name: "MobileNetV2", artifact_id: "art-1" }],
      devices: ["Samsung Galaxy S24 (Family)", "Samsung Galaxy S23 (Family)"],
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
    });

    expect(result.content[0].text).toContain("p1");
    expect(result.content[0].text).toContain("MobileNet Gates");
    expect(receivedBody).toMatchObject({
      name: "MobileNet Gates",
      models: [{ name: "MobileNetV2", artifact_id: "art-1" }],
    });
  });

  it("rejects a 25+ cell matrix client-side", async () => {
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await createPipelineHandler(client, {
      workspace_id: wsId,
      name: "Too big",
      models: Array.from({ length: 6 }, (_, i) => ({ name: `m${i}`, artifact_id: `a${i}` })),
      devices: Array.from({ length: 5 }, (_, i) => `d${i}`),
      gates: [{ metric: "inference_time_ms", operator: "<=", threshold: 10 }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/25|cells|matrix/i);
  });
});
