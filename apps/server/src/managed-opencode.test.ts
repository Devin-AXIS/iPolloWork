import { describe, expect, test } from "bun:test";
import { forwardedProxyEnv } from "./managed-opencode.js";

describe("forwardedProxyEnv", () => {
  test("forwards only non-empty proxy settings", () => {
    expect(forwardedProxyEnv({
      HTTPS_PROXY: "  http://127.0.0.1:7890  ",
      NO_PROXY: "localhost,127.0.0.1",
      HTTP_PROXY: " ",
      IPOLLOWORK_SERVER_TOKEN: "must-not-be-forwarded",
    })).toEqual({
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1",
    });
  });

  test("keeps lowercase variants and Node proxy opt-in", () => {
    expect(forwardedProxyEnv({
      https_proxy: "http://127.0.0.1:7890",
      no_proxy: "localhost",
      NODE_USE_ENV_PROXY: "1",
    })).toEqual({
      https_proxy: "http://127.0.0.1:7890",
      no_proxy: "localhost",
      NODE_USE_ENV_PROXY: "1",
    });
  });
});
