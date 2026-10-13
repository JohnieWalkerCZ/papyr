export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = (process.env.PAPYR_API_ORIGIN || "http://localhost:5080").replace(/\/$/, "");
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  try {
    const response = await fetch(`${origin}/api/v1/auth/setup-status`, {
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && !response.headers.get("content-type")?.includes("json")) {
      return Response.json(
        {
          error: {
            code: "API_HTTP_ERROR",
            message: `The API is reachable but returned HTTP ${response.status}. Check the deployed API image and database configuration.`,
          },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const failure = error as { name?: string; cause?: { code?: string } };
    const code = failure.cause?.code;
    let diagnosticCode = "API_PROXY_FAILED";
    let message = "The web server could not reach the API. Check the API image and internal connection configuration.";
    if (code === "ECONNREFUSED") {
      diagnosticCode = "API_CONNECTION_REFUSED";
      message =
        "The API connection was refused. The API may have crashed during startup or the web image may target the wrong API port. Secure-cookie settings do not cause this error.";
    } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      diagnosticCode = "API_DNS_FAILED";
      message =
        "The web server could not resolve the API hostname. Check that web and API share the Docker network and rebuild the web image with the correct API origin.";
    } else if (failure.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
      diagnosticCode = "API_TIMEOUT";
      message =
        "The API did not respond within 10 seconds. Check container networking, API startup, and database availability.";
    }
    const diagnosticId = crypto.randomUUID();
    console.error(`Setup status proxy failed: ${diagnosticCode}; reference ${diagnosticId}`);
    return Response.json(
      { error: { code: diagnosticCode, message }, diagnosticId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
