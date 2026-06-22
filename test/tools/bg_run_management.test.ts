import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { cancelRunHandler } from "../../src/tools/cancel_run.js";
import { rerunBgHandler } from "../../src/tools/rerun_bg.js";
import { setupBgGithubActionHandler } from "../../src/tools/setup_bg_github_action.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_x";
const wsId = "11111111-1111-1111-1111-111111111111";
const runId = "22222222-2222-2222-2222-222222222222";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("cancel_run tool", () => {
  it("POSTs to /runs/{id}/cancel and reports the freed slot", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/cancel`, () =>
        HttpResponse.json({ run_id: runId, status: "cancelled" })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const r = await cancelRunHandler(client, { workspace_id: wsId, run_id: runId });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("Cancelled run");
    expect(r.content[0].text).toMatch(/active-run slot is now free/i);
  });

  it("maps 409 (already terminal) to a friendly message", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/cancel`, () =>
        HttpResponse.json({ detail: "already terminal" }, { status: 409 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const r = await cancelRunHandler(client, { workspace_id: wsId, run_id: runId });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/already terminal/i);
  });
});

describe("rerun_bg tool", () => {
  it("POSTs to /runs/{id}/rerun-bg and returns the new run id", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/rerun-bg`, () =>
        HttpResponse.json(
          { run_id: "33333333-3333-3333-3333-333333333333", status: "created" },
          { status: 201 }
        )
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const r = await rerunBgHandler(client, { workspace_id: wsId, run_id: runId });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("33333333");
    expect(r.content[0].text).toMatch(/edgegate-runner run/);
  });

  it("maps 409 (active run) to a cancel hint", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/runs/${runId}/rerun-bg`, () =>
        HttpResponse.json({ detail: "active run" }, { status: 409 })
      )
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const r = await rerunBgHandler(client, { workspace_id: wsId, run_id: runId });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/edgegate_cancel_run/);
  });
});

describe("setup_bg_github_action tool", () => {
  it("emits the self-hosted workflow + gh secret commands (no API call)", async () => {
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const r = await setupBgGithubActionHandler(client, {
      workspace_id: wsId,
      adb_serial: "SER123",
    });
    expect(r.isError).toBeUndefined();
    const t = r.content[0].text;
    expect(t).toMatch(/self-hosted/i);
    expect(t).toContain("edgegate-bg");
    expect(t).toContain("gh secret set EDGEGATE_WORKSPACE_ID");
    expect(t).toContain(wsId); // workspace id filled into secrets
    expect(t).toContain("SER123"); // adb serial filled
  });
});
