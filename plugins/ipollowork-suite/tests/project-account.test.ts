import test from "node:test";
import assert from "node:assert/strict";
import { matchesProjectAccount, ProjectAccountMismatch } from "../src/host/project-account.ts";

test("official domain migration accepts old links without trusting lookalike deployments", () => {
  for (const [linked, current] of [
    ["https://work.ipollo.net", "https://cloud.ipollo.net"],
    ["https://cloud.ipollo.net", "https://work.ipollo.net"],
    ["https://work.ipollo.net/", "https://cloud.ipollo.net:443"],
    ["http://localhost:3000", "http://localhost:3000/"],
  ]) assert.equal(matchesProjectAccount(linked!, current!), true);
  for (const linked of [
    "https://unrelated.test", "https://work.ipollo.net.evil.test",
    "http://work.ipollo.net", "https://work.ipollo.net:444",
    "https://user:password@work.ipollo.net", "https://work.ipollo.net/path",
    "https://work.ipollo.net/?token=secret", "https://work.ipollo.net/#fragment", "invalid",
  ]) assert.equal(matchesProjectAccount(linked, "https://cloud.ipollo.net"), false, linked);
  assert.equal(matchesProjectAccount("http://localhost:3000", "http://localhost:3001"), false);
  const error = new ProjectAccountMismatch();
  assert.equal(error.code, "IPW_PROJECT_ACCOUNT_MISMATCH");
  assert.equal(error.status, 403);
  assert.match(error.message, /重新关联项目/);
});
