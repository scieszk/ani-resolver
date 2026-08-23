import type { ProviderRun, ProviderStatus } from "../types.js";

export async function requestJson(
  provider: string,
  fetcher: typeof fetch,
  input: string | URL,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<{ ok: true; data: unknown } | { ok: false; run: ProviderRun }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    let response: Response;
    try {
      response = await fetcher(input, { ...init, signal });
    } catch (error) {
      return failure(provider, "unavailable", formatError(error));
    }

    if (!response.ok) {
      const status = responseStatus(response.status);
      try {
        const detail = await response.text();
        return failure(provider, status, detail || `HTTP ${response.status}`);
      } catch (error) {
        return signal.aborted
          ? failure(provider, "unavailable", formatError(error))
          : failure(provider, status, `HTTP ${response.status}`);
      }
    }

    try {
      return { ok: true, data: await response.json() };
    } catch (error) {
      return failure(
        provider,
        signal.aborted ? "unavailable" : "invalid_response",
        error instanceof Error ? error.message : "upstream returned invalid JSON",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}

function responseStatus(status: number): ProviderStatus {
  if (status === 401 || status === 403) return "auth_required";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "invalid_response";
}

function failure(
  provider: string,
  status: ProviderStatus,
  message: string,
): { ok: false; run: ProviderRun } {
  return { ok: false, run: { provider, status, items: [], message } };
}
