import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { setupGithubActionHandler } from "../../src/tools/setup_github_action.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); server.close(); });

describe("setup_github_action tool", () => {
  it("returns YAML + the gh secret-set commands the user must run", async () => {
    server.use(
      http.get(`${apiUrl}/v1/workspaces/${wsId}/github-action/template`, () =>
        HttpResponse.json({
          workflow_yaml: "name: EdgeGate AI Test\non: [pull_request]\n",
          api_url: "https://api.test",
          secret_names: [
            "EDGEGATE_WORKSPACE_ID",
            "EDGEGATE_API_SECRET",
            "EDGEGATE_PIPELINE_ID",
            "EDGEGATE_MODEL_ARTIFACT_ID",
          ],
        })
      )
    );

    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await setupGithubActionHandler(client, {
      workspace_id: wsId,
      pipeline_id: "p1",
    });

    const text = result.content[0].text;
    expect(text).toContain(".github/workflows/edgegate.yml");
    expect(text).toContain("EdgeGate AI Test");
    expect(text).toContain("gh secret set EDGEGATE_WORKSPACE_ID");
    expect(text).toContain("gh secret set EDGEGATE_API_SECRET");
    expect(text).toContain("p1");
  });
});
