import { USER_AGENT } from "./version.js";
import type {
  APIKeyCreateResponse,
  HFImportJob,
  Pipeline,
  PromptPackCreateBody,
  PromptPackSummary,
  RunBundle,
  RunComparison,
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
      device_matrix: Array<{ name: string; enabled: boolean }>;
      promptpack_ref: { promptpack_id: string; version: string };
      gates: Array<{ metric: string; operator: string; threshold: number; description?: string }>;
      run_policy?: {
        warmup_runs?: number;
        measurement_repeats?: number;
        max_new_tokens?: number;
        timeout_minutes?: number;
      };
      model_matrix?: Array<{ artifact_id: string; label?: string }>;
    }
  ): Promise<Pipeline> {
    return this.request<Pipeline>("POST", `/v1/workspaces/${workspaceId}/pipelines`, body);
  }
  async listPipelines(workspaceId: string): Promise<Pipeline[]> {
    return this.request<Pipeline[]>("GET", `/v1/workspaces/${workspaceId}/pipelines`);
  }
  async triggerRun(
    workspaceId: string,
    body: { pipeline_id: string; trigger?: string; model_artifact_id?: string }
  ): Promise<RunSummary> {
    return this.request<RunSummary>("POST", `/v1/workspaces/${workspaceId}/runs`, body);
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
  async listRunsByPipeline(
    workspaceId: string,
    pipelineId: string,
    limit = 20
  ): Promise<RunSummary[]> {
    return this.request<RunSummary[]>(
      "GET",
      `/v1/workspaces/${workspaceId}/runs?pipeline_id=${pipelineId}&limit=${limit}`
    );
  }
  async getRunDiff(workspaceId: string, runId: string): Promise<RunComparison> {
    return this.request<RunComparison>(
      "GET",
      `/v1/workspaces/${workspaceId}/runs/${runId}/diff`
    );
  }
  async getRunBundle(workspaceId: string, runId: string): Promise<RunBundle> {
    return this.request<RunBundle>("GET", `/v1/workspaces/${workspaceId}/runs/${runId}/bundle`);
  }
  async getWorkflowTemplate(workspaceId: string): Promise<WorkflowTemplate> {
    return this.request<WorkflowTemplate>(
      "GET",
      `/v1/workspaces/${workspaceId}/github-action/template`
    );
  }
  async startHuggingFaceImport(
    workspaceId: string,
    body: { hf_repo_id: string; revision?: string; filename?: string }
  ): Promise<HFImportJob> {
    return this.request<HFImportJob>(
      "POST",
      `/v1/workspaces/${workspaceId}/artifacts/import-huggingface`,
      body
    );
  }
  async getHuggingFaceImportJob(workspaceId: string, jobId: string): Promise<HFImportJob> {
    return this.request<HFImportJob>(
      "GET",
      `/v1/workspaces/${workspaceId}/artifacts/import-huggingface/${jobId}`
    );
  }
  async listPromptPacks(workspaceId: string): Promise<PromptPackSummary[]> {
    return this.request<PromptPackSummary[]>(
      "GET",
      `/v1/workspaces/${workspaceId}/promptpacks`
    );
  }
  async createPromptPack(
    workspaceId: string,
    body: PromptPackCreateBody
  ): Promise<PromptPackSummary> {
    return this.request<PromptPackSummary>(
      "POST",
      `/v1/workspaces/${workspaceId}/promptpacks`,
      body
    );
  }
  async publishPromptPack(
    workspaceId: string,
    promptpackId: string,
    version: string
  ): Promise<PromptPackSummary> {
    return this.request<PromptPackSummary>(
      "PUT",
      `/v1/workspaces/${workspaceId}/promptpacks/${promptpackId}/${version}/publish`
    );
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE" | "PUT",
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
