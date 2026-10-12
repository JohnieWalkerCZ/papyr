import assert from "node:assert/strict";
import test from "node:test";
import { compareTextVersions } from "../src/lib/conflict-diff.ts";

test("text comparison marks additions, removals, and unchanged lines", () => {
  assert.deepEqual(compareTextVersions("one\nold\nthree", "one\nnew\nthree"), [
    { kind: "same", text: "one" },
    { kind: "removed", text: "old" },
    { kind: "added", text: "new" },
    { kind: "same", text: "three" },
  ]);
});

test("large texts skip diff computation while remaining available in source panels", () => {
  const long = Array.from({ length: 501 }, (_, index) => String(index)).join("\n");
  assert.equal(compareTextVersions(long, long), null);
});
