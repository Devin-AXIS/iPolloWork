import { describe, expect, test } from "bun:test";
import { forwardedProxyEnv, offlineFirstOpencodeEnv } from "./managed-opencode.js";

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

describe("offlineFirstOpencodeEnv", () => {
  test("disables startup network fetches by default", () => {
    expect(offlineFirstOpencodeEnv({})).toEqual({
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    });
  });

  test("uses the local development catalog and preserves explicit overrides", () => {
    expect(offlineFirstOpencodeEnv({ IPOLLOWORK_DEV_MODE: "1" })).toEqual({
      OPENCODE_MODELS_URL: "http://localhost:8791/models",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    });
    expect(offlineFirstOpencodeEnv({
      OPENCODE_MODELS_URL: "https://models.example.test/catalog.json",
      OPENCODE_DISABLE_AUTOUPDATE: "0",
      OPENCODE_DISABLE_MODELS_FETCH: "0",
    })).toEqual({
      OPENCODE_MODELS_URL: "https://models.example.test/catalog.json",
      OPENCODE_DISABLE_AUTOUPDATE: "0",
      OPENCODE_DISABLE_MODELS_FETCH: "0",
    });
  });
});
