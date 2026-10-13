let requestSequence = 0;

export function safeErrorDetails(error: unknown) {
  const failure = error as { name?: unknown; status?: unknown; code?: unknown; diagnosticId?: unknown } | null;
  return {
    name: typeof failure?.name === "string" ? failure.name : "UnknownError",
    status: typeof failure?.status === "number" ? failure.status : undefined,
    code: typeof failure?.code === "string" ? failure.code : undefined,
    diagnosticId: typeof failure?.diagnosticId === "string" ? failure.diagnosticId : undefined,
  };
}

export async function fetchWithDiagnostics(path: string, init: RequestInit = {}): Promise<Response> {
  const requestId = ++requestSequence;
  const details = { requestId, method: init.method ?? "GET", path: new URL(path, "http://papyr.invalid").pathname };
  const startedAt = performance.now();
  console.info("[Papyr network] request started", details);
  try {
    const response = await fetch(path, init);
    const completed = { ...details, status: response.status, durationMs: Math.round(performance.now() - startedAt) };
    if (response.ok) console.info("[Papyr network] response received", completed);
    else console.warn("[Papyr network] HTTP error", completed);
    return response;
  } catch (error) {
    console.error("[Papyr network] request failed", {
      ...details,
      durationMs: Math.round(performance.now() - startedAt),
      ...safeErrorDetails(error),
    });
    throw error;
  }
}
