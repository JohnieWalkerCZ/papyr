import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/v1/auth/setup-status/route.ts";

const request = new Request("http://papyr.test/api/v1/auth/setup-status", {
  headers: { cookie: "papyr_session=test" },
});

test("setup proxy forwards session and preserves API success and JSON diagnostics", async (t) => {
  for (const status of [200, 503]) {
    const body =
      status === 200
        ? { complete: false }
        : { error: { code: "DATABASE_SCHEMA_ERROR" }, diagnosticId: "api-reference" };
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(body, { status }));
    const response = await GET(request);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    const [url, options] = fetch.mock.calls[0].arguments;
    assert.ok(url.endsWith("/api/v1/auth/setup-status"));
    assert.equal(options.headers.get("cookie"), "papyr_session=test");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "manual");
    assert.equal(response.headers.get("cache-control"), "no-store");
    fetch.mock.restore();
  }
});

test("setup proxy explains transport failures without exposing internal details", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const [name, code, expected] of [
    ["TypeError", "ECONNREFUSED", "API_CONNECTION_REFUSED"],
    ["TypeError", "ENOTFOUND", "API_DNS_FAILED"],
    ["TypeError", "EAI_AGAIN", "API_DNS_FAILED"],
    ["TimeoutError", undefined, "API_TIMEOUT"],
    ["TypeError", "UND_ERR_CONNECT_TIMEOUT", "API_TIMEOUT"],
    ["TypeError", "UNKNOWN", "API_PROXY_FAILED"],
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      throw Object.assign(new Error("private host and credentials"), { name, cause: { code } });
    });
    const response = await GET(request);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, expected);
    assert.ok(body.diagnosticId);
    assert.ok(!JSON.stringify(body).includes("private host"));
    fetch.mock.restore();
  }
});

test("setup proxy distinguishes a reachable API with a non-JSON error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("private exception", { status: 500 }));
  const response = await GET(request);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "API_HTTP_ERROR");
  assert.ok(!JSON.stringify(body).includes("private exception"));
});
