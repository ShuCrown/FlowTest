import type {
  FlowDetail,
  FlowSummary,
  InspectorSession,
  RecordingDetail,
  RecordingRow,
  RunDetail,
  RunRow,
  Settings,
  SystemRow,
} from "./types.js";
import type { FlowDsl } from "@flowforge/dsl";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly pointer?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { code?: string; status?: number; pointer?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = options.code ?? "API_ERROR";
    this.status = options.status ?? 500;
    this.pointer = options.pointer;
    this.details = options.details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const payload = body as { error?: { code?: string; message?: string; pointer?: string; details?: unknown } };
    throw new ApiClientError(payload?.error?.message ?? `请求失败 ${response.status}`, {
      code: payload?.error?.code,
      status: response.status,
      pointer: payload?.error?.pointer,
      details: payload?.error?.details,
    });
  }
  return body as T;
}

export const api = {
  systems: {
    list: () => request<{ systems: SystemRow[] }>("/api/systems").then((r) => r.systems),
    create: (body: {
      id?: string;
      name: string;
      baseUrl: string;
      auth?: { kind: string; path?: string; env?: string };
    }) => request<SystemRow>("/api/systems", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<SystemRow>) =>
      request<SystemRow>(`/api/systems/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/systems/${id}`, { method: "DELETE" }),
    openSession: (id: string, headless?: boolean) =>
      request<{ session: InspectorSession }>(`/api/systems/${id}/session`, {
        method: "POST",
        body: JSON.stringify({ headless }),
      }).then((r) => r.session),
    saveSession: (id: string) =>
      request<{ system: SystemRow; path: string }>(`/api/systems/${id}/session`, {
        method: "PUT",
      }),
    closeSession: (id: string) =>
      request<{ ok: boolean }>(`/api/systems/${id}/session`, { method: "DELETE" }),
  },
  flows: {
    list: () => request<{ flows: FlowSummary[] }>("/api/flows").then((r) => r.flows),
    get: (id: string) => request<FlowDetail>(`/api/flows/${id}`),
    create: (body: { name?: string; dsl: FlowDsl; layout?: unknown }) =>
      request<FlowDetail>("/api/flows", { method: "POST", body: JSON.stringify(body) }),
    update: (
      id: string,
      body: { name?: string; dsl?: FlowDsl; layout?: unknown; revision?: number },
    ) => request<FlowDetail>(`/api/flows/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/flows/${id}`, { method: "DELETE" }),
    validate: (id: string, dsl?: FlowDsl) =>
      request<{
        ok: boolean;
        readiness: { level: number; gaps: Array<Record<string, unknown>> };
        lint: {
          errors: Array<Record<string, unknown>>;
          warnings: Array<Record<string, unknown>>;
          infos: Array<Record<string, unknown>>;
        };
        errors: unknown[];
      }>(`/api/flows/${id}/validate`, {
        method: "POST",
        body: JSON.stringify(dsl ? { dsl } : {}),
      }),
    publish: (id: string) =>
      request<{ id: string; version: number; checksum: string; createdAt: string }>(
        `/api/flows/${id}/publish`,
        { method: "POST" },
      ),
    versions: (id: string) =>
      request<{ versions: Array<{ id: string; version: number; createdAt: string }> }>(
        `/api/flows/${id}/versions`,
      ).then((r) => r.versions),
    import: (body: { dsl: unknown; flowId?: string; save?: boolean }) =>
      request<{ ok: boolean; diff?: unknown[]; flow?: FlowDetail }>("/api/flows/import", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  runs: {
    list: (flowId?: string) =>
      request<{ runs: RunRow[] }>(`/api/runs${flowId ? `?flowId=${flowId}` : ""}`).then(
        (r) => r.runs,
      ),
    get: (id: string) => request<RunDetail>(`/api/runs/${id}`),
    start: (
      flowId: string,
      body: {
        datasetId?: string;
        mode?: "probe" | "single";
        versionId?: string;
        stopAtNodeId?: string;
        headless?: boolean;
      },
    ) => request<RunRow>(`/api/flows/${flowId}/runs`, { method: "POST", body: JSON.stringify(body) }),
    batch: (
      flowId: string,
      body: { datasetIds?: string[]; versionId?: string; headless?: boolean },
    ) =>
      request<{ batch: { id: string; status: string }; runs: RunRow[] }>(
        `/api/flows/${flowId}/batches`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    cancel: (id: string) => request<{ ok: boolean }>(`/api/runs/${id}/cancel`, { method: "POST" }),
    confirm: (id: string, body: { requestId: string; action: "continue" | "abort"; nth?: number }) =>
      request<{ ok: boolean }>(`/api/runs/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  inspector: {
    current: () =>
      request<{ session: InspectorSession | null }>("/api/inspector/current").then((r) => r.session),
    open: (systemId: string, headless?: boolean, path?: string) =>
      request<{ session: InspectorSession }>("/api/inspector/open", {
        method: "POST",
        body: JSON.stringify({ systemId, headless, path }),
      }).then((r) => r.session),
    pick: (id: string) =>
      request<{
        ok: boolean;
        target?: import("@flowforge/dsl").TargetRef;
        fingerprint?: unknown;
        frameUrl?: string;
        reason?: string;
      }>(`/api/inspector/${id}/pick`, { method: "POST" }),
    testTarget: (id: string, target: unknown) =>
      request<{ ok: boolean; attempts: Array<{ strategy: string; count: number; error?: string }> }>(
        `/api/inspector/${id}/test-target`,
        { method: "POST", body: JSON.stringify({ target }) },
      ),
    close: (id: string) => request<{ ok: boolean }>(`/api/inspector/${id}/close`, { method: "POST" }),
  },
  recordings: {
    list: () =>
      request<{ recordings: RecordingRow[] }>("/api/recordings").then((r) => r.recordings),
    start: (systemId: string) =>
      request<{ id: string; sessionId: string; status: string }>("/api/recordings", {
        method: "POST",
        body: JSON.stringify({ systemId }),
      }),
    stop: (id: string) =>
      request<RecordingDetail & { events: unknown[]; clusters: unknown[] }>(
        `/api/recordings/${id}/stop`,
        { method: "POST" },
      ),
    get: (id: string) => request<RecordingDetail>(`/api/recordings/${id}`),
    refold: (id: string) =>
      request<{ clusters: unknown[]; ruleVersion: string }>(`/api/recordings/${id}/refold`, {
        method: "POST",
      }),
  },
  settings: {
    get: () => request<{ settings: Settings }>("/api/settings").then((r) => r.settings),
    patch: (patch: Partial<Settings>) =>
      request<{ settings: Settings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }).then((r) => r.settings),
  },
  health: () =>
    request<{
      ok: boolean;
      playwright: { version: string; chromium: string | null };
      dataDir: string;
      dataWritable: boolean;
      db: { ok: boolean; path: string };
      runtime: string;
    }>("/api/health"),
};
