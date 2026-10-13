import assert from "node:assert/strict";
import test from "node:test";
import { createUuid } from "../src/lib/uuid.js";

test("UUID generation uses the native implementation when available", (t) => {
  const expected = "12345678-1234-4321-8123-123456789abc";
  const native = t.mock.method(crypto, "randomUUID", () => expected);
  assert.equal(createUuid(), expected);
  assert.equal(native.mock.calls.length, 1);
  assert.equal(native.mock.calls[0].this, crypto);
});

test("UUID fallback preserves random bytes and sets v4 version and variant bits", (t) => {
  t.mock.property(crypto, "randomUUID", undefined);
  t.mock.method(crypto, "getRandomValues", (bytes) => {
    bytes.set([0, 1, 2, 3, 4, 5, 0xff, 7, 0xff, 9, 10, 11, 12, 13, 14, 15]);
    return bytes;
  });
  assert.equal(createUuid(), "00010203-0405-4f07-bf09-0a0b0c0d0e0f");
});

test("UUID fallback generates distinct valid v4 identifiers", (t) => {
  t.mock.property(crypto, "randomUUID", undefined);
  const ids = Array.from({ length: 100 }, () => createUuid());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
