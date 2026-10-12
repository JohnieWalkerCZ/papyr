import assert from "node:assert/strict";
import test from "node:test";
import { retryTransient } from "../src/lib/sync-retry.ts";

test("transient sync failures retry with a bounded attempt count", async () => {
  let attempts = 0;
  const result = await retryTransient(async () => {
    if (attempts++ < 2) throw Object.assign(new Error("busy"), { status: 503 });
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("permanent sync failures are not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    retryTransient(async () => {
      attempts++;
      throw Object.assign(new Error("bad request"), { status: 400 });
    }),
  );
  assert.equal(attempts, 1);
});
