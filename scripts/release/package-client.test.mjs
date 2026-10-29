import assert from "node:assert/strict";
import test from "node:test";

import { nextClientVersion } from "./package-client.mjs";

test("client packaging advances a semantic patch version", () => {
  assert.equal(nextClientVersion("0.0.0"), "0.0.1");
  assert.equal(nextClientVersion("0.50.30"), "0.50.31");
});

test("client packaging preserves the selected major and minor version", () => {
  assert.equal(nextClientVersion("0.99.0"), "0.99.1");
  assert.equal(nextClientVersion("1.100.9"), "1.100.10");
});

test("client packaging rejects malformed versions", () => {
  for (const version of ["v0.50.30", "0.50", "01.2.3", "0.50.30-beta"]) {
    assert.throws(() => nextClientVersion(version), /semantic versioning/);
  }
});
