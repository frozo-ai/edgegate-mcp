import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EdgeGateClient } from "../../src/client.js";
import { inviteMemberHandler } from "../../src/tools/invite_member.js";
import { changeMemberRoleHandler } from "../../src/tools/change_member_role.js";
import { removeMemberHandler } from "../../src/tools/remove_member.js";

const apiUrl = "https://api.test";
const apiKey = "egk_test_xxx";
const wsId = "00000000-0000-0000-0000-000000000001";
const userId = "22222222-2222-2222-2222-222222222222";
const server = setupServer();
beforeEach(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("invite_member tool", () => {
  it("returns 404 guidance when target user has no EdgeGate account", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/members`, () =>
        HttpResponse.json(
          { detail: "User with email alice@example.com not found" },
          { status: 404 },
        ),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await inviteMemberHandler(client, {
      workspace_id: wsId,
      user_email: "alice@example.com",
      role: "admin",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/register|edgegate.frozo.ai/i);
  });

  it("routes 409 toward role-change guidance", async () => {
    server.use(
      http.post(`${apiUrl}/v1/workspaces/${wsId}/members`, () =>
        HttpResponse.json(
          { detail: "User is already a member of this workspace" },
          { status: 409 },
        ),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await inviteMemberHandler(client, {
      workspace_id: wsId,
      user_email: "alice@example.com",
      role: "admin",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/already a member/i);
    expect(result.content[0].text).toMatch(/change_member_role/i);
  });
});

describe("change_member_role tool", () => {
  it("explains the last-owner guard on 400", async () => {
    server.use(
      http.put(`${apiUrl}/v1/workspaces/${wsId}/members/${userId}`, () =>
        HttpResponse.json(
          { detail: "Cannot remove the last owner from workspace" },
          { status: 400 },
        ),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await changeMemberRoleHandler(client, {
      workspace_id: wsId,
      user_id: userId,
      role: "viewer",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/last owner|promote another/i);
  });

  it("returns success with new role label on 200", async () => {
    server.use(
      http.put(`${apiUrl}/v1/workspaces/${wsId}/members/${userId}`, () =>
        HttpResponse.json({
          user_id: userId,
          email: "bob@example.com",
          role: "admin",
        }),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await changeMemberRoleHandler(client, {
      workspace_id: wsId,
      user_id: userId,
      role: "admin",
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("bob@example.com");
    expect(result.content[0].text).toContain("admin");
  });
});

describe("remove_member tool", () => {
  it("returns success on 204 with preservation note", async () => {
    server.use(
      http.delete(
        `${apiUrl}/v1/workspaces/${wsId}/members/${userId}`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await removeMemberHandler(client, {
      workspace_id: wsId,
      user_id: userId,
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toMatch(/preserved|pipelines and runs/i);
  });

  it("explains last-owner guard on 400", async () => {
    server.use(
      http.delete(`${apiUrl}/v1/workspaces/${wsId}/members/${userId}`, () =>
        HttpResponse.json(
          { detail: "Cannot remove the last owner from workspace" },
          { status: 400 },
        ),
      ),
    );
    const client = new EdgeGateClient({ apiUrl, apiKey });
    const result = await removeMemberHandler(client, {
      workspace_id: wsId,
      user_id: userId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/last owner|promote another/i);
  });
});
