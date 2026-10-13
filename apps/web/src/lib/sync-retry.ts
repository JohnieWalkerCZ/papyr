export async function retryTransient<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      const transient =
        error instanceof TypeError || (typeof status === "number" && [408, 429, 500, 502, 503, 504].includes(status));
      if (!transient || attempt >= 2) throw error;
      console.warn("[Papyr network] retrying transient failure", {
        attempt: attempt + 1,
        delayMs: 250 * 2 ** attempt,
        status: typeof status === "number" ? status : undefined,
      });
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}
