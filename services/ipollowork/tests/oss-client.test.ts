/** ECS role credentials renew without exposing keys or signing unusable internal download URLs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ECSRAMRoleCredentialsProvider } from "@alicloud/credentials";
import { OssClients } from "../src/oss-client.js";

const setting = { region: "oss-cn-heyuan", bucket: "test-published" };

test("role credentials reach signed downloads through the public endpoint and fail closed", async (t) => {
  let revision = 0;
  const credentials = t.mock.method(ECSRAMRoleCredentialsProvider.prototype, "getCredentials", async () => ({
    accessKeyId: "temporary-id",
    accessKeySecret: "temporary-secret",
    securityToken: "temporary-" + ++revision,
    providerName: "ecs-test",
  }));
  const clients = new OssClients("ipollowork-storage", true);
  try {
    const first = new URL((await clients.create(setting, true)).signatureUrl("test.html"));
    const second = new URL((await clients.create(setting, true)).signatureUrl("test.html"));
    assert.equal(first.hostname, "test-published.oss-cn-heyuan.aliyuncs.com");
    assert.equal(first.searchParams.get("security-token"), "temporary-1");
    assert.equal(second.searchParams.get("security-token"), "temporary-2");
    credentials.mock.mockImplementation(async () => { throw new Error("private metadata detail"); });
    await assert.rejects(clients.create({ ...setting, accessKeyId: "old", accessKeySecret: "old" }), (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message.includes("private metadata detail"), false);
      return "code" in error && error.code === "OSS_CREDENTIAL_UNAVAILABLE";
    });
  } finally {
    clients.close();
  }
});

test("stored keys remain usable outside ECS and incomplete settings cannot create a client", async () => {
  const clients = new OssClients();
  try {
    await assert.rejects(clients.create(setting), { code: "OSS_NOT_CONFIGURED" });
    const url = new URL((await clients.create({ ...setting, accessKeyId: "local-id", accessKeySecret: "local-secret" })).signatureUrl("test.pdf"));
    assert.equal(url.searchParams.has("security-token"), false);
    assert.equal(url.searchParams.get("OSSAccessKeyId"), "local-id");
  } finally {
    clients.close();
  }
});
