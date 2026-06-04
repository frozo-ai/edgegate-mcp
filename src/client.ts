import { USER_AGENT } from "./version.js";
import type {
  APIKeyCreateResponse,
  AuditReport,
  Pipeline,
  RunDetail,
  RunSummary,
  Workspace,
  WorkflowTemplate,
} from "./types.js";

export interface EdgeGateClientOptions {
  apiUrl: string;
  apiKey: string;
  retryDelayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export class EdgeGateError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly url: string
  ) {
    super(`EdgeGate ${status} at ${url}: ${detail}`);
    this.name = "EdgeGateError";
  }
}

export class EdgeGateClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(opts: EdgeGateClientOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    return this.request<Workspace>("GET", `/v1/workspaces/${workspaceId}`);
  }
  async listWorkspaces(): Promise<Workspace[]> {
    return this.request<Workspace[]>("GET", `/v1/workspaces`);
  }
  async createAPIKey(
    workspaceId: string,
    body: { name: string; expires_at?: string }
  ): Promise<APIKeyCreateResponse> {
    return this.request<APIKeyCreateResponse>(
      "POST",
      `/v1/workspaces/${workspaceId}/api-keys`,
      body
    );
  }
  async createPipeline(
    workspaceId: string,
    body: {
      name: string;
      description?: string;
      models: Array<{ name: string; artifact_id: string }>;
      devices: string[];
      gates: Array<{ metric: string; operator: string; threshold: number }>;
      promptpack_id?: string;
      repeats?: number;
    }
  ): Promise<Pipeline> {
    return this.request<Pipeline>("POST", `/v1/workspaces/${workspaceId}/pipelines`, body);
  }
  async listPipelines(workspaceId: string): Promise<Pipeline[]> {
    return this.request<Pipeline[]>("GET", `/v1/workspaces/${workspaceId}/pipelines`);
  }
  async triggerRun(
    workspaceId: string,
    pipelineId: string,
    body: { trigger?: string; model_artifact_id?: string } = {}
  ): Promise<RunSummary> {
    return this.request<RunSummary>(
      "POST",
      `/v1/workspaces/${workspaceId}/pipelines/${pipelineId}/runs`,
      body
    );
  }
  async getRun(workspaceId: string, runId: string): Promise<RunDetail> {
    return this.request<RunDetail>("GET", `/v1/workspaces/${workspaceId}/runs/${runId}`);
  }
  async listRuns(workspaceId: string, limit = 20): Promise<RunSummary[]> {
    return this.request<RunSummary[]>(
      "GET",
      `/v1/workspaces/${workspaceId}/runs?limit=${limit}`
    );
  }
  async getAuditReport(workspaceId: string, runId: string): Promise<AuditReport> {
    return this.request<AuditReport>(
      "GET",
      `/v1/workspaces/${workspaceId}/runs/${runId}/audit-report`
    );
  }
  async getWorkflowTemplate(workspaceId: string): Promise<WorkflowTemplate> {
    return this.request<WorkflowTemplate>(
      "GET",
      `/v1/workspaces/${workspaceId}/github-action/template`
    );
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const isIdempotent = method === "GET";
    const attempts = isIdempotent ? this.maxRetries + 1 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        "User-Agent": USER_AGENT,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await resp.text();
      const json = text ? safeJson(text) : null;
      if (resp.ok) {
        return json as T;
      }
      const detail =
        json && typeof json === "object" && "detail" in json
          ? String((json as { detail: unknown }).detail)
          : text || "Unknown error";
      if (resp.status >= 500 && isIdempotent && attempt < attempts) {
        await sleep(this.retryDelayMs);
        continue;
      }
      throw new EdgeGateError(resp.status, detail, url);
    }
    throw new Error("retry loop exited unexpectedly");
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
