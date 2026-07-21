import { describe, expect, test } from "bun:test";

import { readLimitedRequestBody } from "./limited-request-body.js";

describe("limited request bodies", () => {
  test("reads a body that stays within the limit", async () => {
    const request = new Request("http://localhost/upload", { method: "POST", body: new Uint8Array([1, 2, 3]) });
    expect(await readLimitedRequestBody(request, 3)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("rejects a streamed body as soon as it exceeds the limit", async () => {
    const request = new Request("http://localhost/upload", { method: "POST", body: new Uint8Array([1, 2, 3, 4]) });
    await expect(readLimitedRequestBody(request, 3)).rejects.toMatchObject({ status: 413, code: "template_package_too_large" });
  });

  test("rejects an oversized declared content length before reading", async () => {
    const request = new Request("http://localhost/upload", { method: "POST", headers: { "Content-Length": "4" }, body: new Uint8Array([1]) });
    await expect(readLimitedRequestBody(request, 3)).rejects.toMatchObject({ status: 413, code: "template_package_too_large" });
  });
});
