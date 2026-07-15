import assert from "node:assert/strict";
import test from "node:test";

import { nextClientVersion } from "./package-client.mjs";

test("client package sequence starts at 0.1.0", () => {
  assert.equal(nextClientVersion("0.0.0"), "0.1.0");
  assert.equal(nextClientVersion("0.1.0"), "0.2.0");
});

test("client package sequence rolls the hundredth release into the next major", () => {
  assert.equal(nextClientVersion("0.99.0"), "1.0.0");
  assert.equal(nextClientVersion("1.99.0"), "2.0.0");
});

test("client package sequence rejects patch versions", () => {
  assert.throws(() => nextClientVersion("0.17.20"), /X\.Y\.0 release sequence/);
});
