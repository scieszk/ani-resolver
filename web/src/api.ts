import type {
  AniResolverApi,
  CleanupStats,
  CreateWebRunInput,
  StorageStats,
  WebProvider,
  WebRun,
  WebFavorite,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const webApi: AniResolverApi = {
  async listRuns(query = "") {
    const search = query ? `?query=${encodeURIComponent(query)}` : "";
    return request<{ items: WebRun[]; total: number }>(`/api/runs${search}`);
  },
  async getRun(id) {
    try {
      return await request<WebRun>(`/api/runs/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  async createRun(input: CreateWebRunInput) {
    const body = new FormData();
    body.set("input", input.input);
    body.set("target", input.target);
    body.set("providers", input.providers.join(","));
    if (input.appearance) body.set("appearance", JSON.stringify(input.appearance));
    if (input.work) body.set("work", JSON.stringify(input.work));
    for (const attachment of input.attachments) body.append("attachments", attachment);
    return request<WebRun>("/api/runs", { method: "POST", body });
  },
  async deleteRun(id) {
    await request<void>(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async listFavorites(query = "", entityType = "") {
    const search = new URLSearchParams();
    if (query) search.set("query", query);
    if (entityType) search.set("type", entityType);
    return request<{ items: WebFavorite[]; total: number }>(
      `/api/favorites${search.size ? `?${search}` : ""}`,
    );
  },
  async saveFavorite(runId, candidateKey) {
    return request<WebFavorite>("/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, candidateKey }),
    });
  },
  async deleteFavorite(id) {
    await request<void>(`/api/favorites/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async listProviders() {
    return request<{ items: WebProvider[] }>("/api/providers");
  },
  async getStorage() {
    return request<StorageStats>("/api/storage");
  },
  async cleanupStorage() {
    return request<CleanupStats>("/api/storage/cleanup", { method: "POST" });
  },
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const error = record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : {};
    throw new ApiError(
      typeof error.message === "string" ? error.message : `Request failed with ${response.status}`,
      response.status,
      payload,
    );
  }
  return payload as T;
}
