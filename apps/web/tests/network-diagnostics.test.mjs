import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithDiagnostics, safeErrorDetails } from "../src/lib/network-diagnostics.ts";

test("network logs correlate requests and redact bodies, headers, and query tokens", async (t) => {
  const logs = [];
  t.mock.method(console, "info", (...values) => logs.push(values));
  t.mock.method(console, "warn", (...values) => logs.push(values));
  t.mock.method(globalThis, "fetch", async () => new Response("private response", { status: 503 }));
  const response = await fetchWithDiagnostics("/api/v1/bootstrap?cursorToken=private-query", {
    method: "POST",
    headers: { Cookie: "private-cookie" },
    body: "private-note",
  });
  assert.equal(response.status, 503);
  assert.equal(logs[0][1].requestId, logs[1][1].requestId);
  assert.equal(logs[0][1].path, "/api/v1/bootstrap");
  assert.equal(logs[1][1].status, 503);
  assert.ok(!JSON.stringify(logs).includes("private-"));
});

test("transport failures are logged safely and rethrown unchanged", async (t) => {
  const logs = [];
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "error", (...values) => logs.push(values));
  const error = Object.assign(new TypeError("private credentials"), {
    status: 503,
    code: "DATABASE_UNAVAILABLE",
    diagnosticId: "reference",
    body: "private-note",
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw error;
  });
  await assert.rejects(fetchWithDiagnostics("/api/v1/auth/me"), (failure) => failure === error);
  assert.equal(logs[0][1].name, "TypeError");
  assert.equal(logs[0][1].code, "DATABASE_UNAVAILABLE");
  assert.ok(!JSON.stringify(logs).includes("private"));
  assert.equal(safeErrorDetails(null).name, "UnknownError");
});
