import { fetchWithDiagnostics, safeErrorDetails } from "./network-diagnostics";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly diagnosticId?: string,
  ) {
    super(message);
  }
}

export interface SessionUser {
  id: string;
  username?: string;
  isAdmin: boolean;
}

export interface MutationReceipt {
  operationId: string;
  status: "accepted" | "duplicate" | "conflict" | "rejected" | "retryable";
  entityId: string;
  revision?: string | null;
  currentRevision?: string | null;
  serverCursor?: string | null;
  error?: { code: string; message: string } | null;
}

export interface ServerEntity {
  id: string;
  kind: "folder" | "note";
  parentId?: string | null;
  folderId?: string | null;
  title: string;
  type?: "markdown" | "typst" | "whiteboard" | null;
  content?: string | unknown;
  contentSchemaVersion?: number | null;
  revision: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerChange {
  sequence: string;
  operationId: string;
  entityType: "folder" | "note";
  entityId: string;
  action: string;
  revision: string;
  entity: ServerEntity;
}

async function csrfToken() {
  const response = await fetchWithDiagnostics("/api/v1/auth/csrf", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw await apiError(response);
  return ((await response.json()) as { token: string }).token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) {
    headers.set("X-CSRF-TOKEN", await csrfToken());
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetchWithDiagnostics(`/api/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw await apiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function apiError(response: Response) {
  let code: string | undefined;
  let diagnosticId: string | undefined;
  let message = `Papyr API request failed (${response.status}).`;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
      title?: string;
      diagnosticId?: string;
    };
    code = body.error?.code;
    diagnosticId = body.diagnosticId;
    message = body.error?.message || body.title || message;
  } catch {
    // Keep the safe status message when the server did not return JSON.
  }
  const error = new ApiError(message, response.status, code, diagnosticId);
  console.warn("[Papyr network] API error details", safeErrorDetails(error));
  return error;
}

export const api = {
  setupStatus() {
    return request<{ complete: boolean }>("/auth/setup-status");
  },
  async me() {
    return request<SessionUser>("/auth/me");
  },
  login(username: string, password: string) {
    return request<SessionUser>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  },
  setup(username: string, password: string, setupToken: string, confirmReset: boolean) {
    return request<SessionUser>("/setup", {
      method: "POST",
      headers: { "X-Papyr-Setup-Token": setupToken },
      body: JSON.stringify({ username, password, confirmReset }),
    });
  },
  createAccount(username: string, password: string) {
    return request<SessionUser>("/auth/accounts", { method: "POST", body: JSON.stringify({ username, password }) });
  },
  logout() {
    return request<void>("/auth/logout", { method: "POST", body: "{}" });
  },
  mutations(operations: unknown[]) {
    return request<{ results: MutationReceipt[] }>("/mutations", {
      method: "POST",
      body: JSON.stringify({ operations }),
    });
  },
  bootstrap(cursorToken?: string | null) {
    const query = new URLSearchParams({ limit: "200" });
    if (cursorToken) query.set("cursorToken", cursorToken);
    return request<{
      folders: ServerEntity[];
      notes: ServerEntity[];
      cursor?: string | null;
      nextCursorToken?: string | null;
    }>(`/bootstrap?${query}`);
  },
  changes(cursor: string) {
    const query = new URLSearchParams({ cursor, limit: "200" });
    return request<{ changes: ServerChange[]; nextCursor: string; hasMore: boolean }>(`/changes?${query}`);
  },
  entity(kind: "folder" | "note", id: string) {
    return request<ServerEntity>(`/${kind}s/${id}`);
  },
  async uploadAsset(asset: { id: string; blob: Blob; mimeType: string; sha256: string }) {
    const headers = new Headers({
      "X-CSRF-TOKEN": await csrfToken(),
      "X-Asset-Id": asset.id,
      "X-Content-SHA256": asset.sha256,
    });
    const body = new FormData();
    body.append("file", asset.blob, "attachment");
    const response = await fetchWithDiagnostics("/api/v1/assets", {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw await apiError(response);
    return (await response.json()) as {
      id: string;
      sha256: string;
      mimeType: string;
      byteLength: number;
      status: "stored" | "duplicate";
    };
  },
  async downloadAsset(id: string) {
    const response = await fetchWithDiagnostics(`/api/v1/assets/${id}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw await apiError(response);
    const sha256 = response.headers.get("X-Content-SHA256");
    if (!sha256 || !/^[0-9a-f]{64}$/i.test(sha256))
      throw new Error("The attachment server omitted its integrity hash.");
    return { blob: await response.blob(), sha256: sha256.toLowerCase() };
  },
};
