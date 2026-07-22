import { describe, expect, test } from "bun:test";

describe("plugin authorization methods", () => {
  test("starts a public-client OAuth flow with PKCE and keeps the verifier private", async () => {
    const { startPluginAuthorizationFlow } = await import("./plugin-authorization.js");
    const started = await startPluginAuthorizationFlow({
      installationId: "install_acme",
      accountId: "default",
      now: 1_800_000_000_000,
      method: {
        id: "acme-oauth",
        kind: "oauth-pkce",
        label: "Continue with Acme",
        clientId: "desktop-public-client",
        authorizationUrl: "https://accounts.acme.example/authorize",
        tokenUrl: "https://accounts.acme.example/token",
        scopes: ["profile", "research.read"],
      },
      callbackUrl: "http://127.0.0.1:3210/plugin-authorization/callback",
    });

    const authorizationUrl = new URL(started.public.authorizationUrl);
    expect(started.public).toMatchObject({ kind: "oauth-pkce", status: "pending" });
    expect(authorizationUrl.searchParams.get("client_id")).toBe("desktop-public-client");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("state")).toBe(started.private.state);
    expect(started.private.pkceVerifier.length).toBeGreaterThanOrEqual(43);
    expect(JSON.stringify(started.public)).not.toContain(started.private.pkceVerifier);
  });

  test("starts device and QR authorization from plugin-owned endpoints", async () => {
    const { startPluginAuthorizationFlow } = await import("./plugin-authorization.js");
    const requests: string[] = [];
    const started = await startPluginAuthorizationFlow({
      installationId: "install_tv",
      accountId: "living-room",
      now: 1_800_000_000_000,
      method: {
        id: "tv-device",
        kind: "device-code",
        label: "Scan or enter a code",
        clientId: "ipollowork-tv",
        deviceAuthorizationUrl: "https://login.tv.example/device",
        tokenUrl: "https://login.tv.example/token",
        scopes: ["library.read"],
        qr: true,
      },
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(JSON.stringify({
          device_code: "private-device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://login.tv.example/activate",
          verification_uri_complete: "https://login.tv.example/activate?code=ABCD-EFGH",
          expires_in: 600,
          interval: 5,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    expect(requests).toEqual(["https://login.tv.example/device"]);
    expect(started.public).toMatchObject({
      kind: "device-code",
      status: "pending",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://login.tv.example/activate",
      qrValue: "https://login.tv.example/activate?code=ABCD-EFGH",
      pollIntervalMs: 5_000,
    });
    expect(JSON.stringify(started.public)).not.toContain("private-device-code");
    expect(started.private.deviceCode).toBe("private-device-code");
  });

  test("starts a one-time plugin-hosted browser flow without global keys", async () => {
    const { startPluginAuthorizationFlow } = await import("./plugin-authorization.js");
    process.env.PLUGIN_PLATFORM_TEST_GLOBAL_KEY = "must-stay-untouched";
    try {
      const started = await startPluginAuthorizationFlow({
        installationId: "install_vendor",
        accountId: "default",
        now: 1_800_000_000_000,
        method: {
          id: "vendor-connect",
          kind: "hosted-browser",
          label: "Connect in browser",
          startUrl: "https://plugins.vendor.example/connect",
          callbackOrigin: "https://plugins.vendor.example",
          exchangeUrl: "https://plugins.vendor.example/token",
        },
        callbackUrl: "http://127.0.0.1:3210/plugin-authorization/callback",
      });

      const url = new URL(started.public.authorizationUrl);
      expect(started.public).toMatchObject({ kind: "hosted-browser", status: "pending" });
      expect(url.searchParams.get("state")).toBe(started.private.state);
      expect(url.searchParams.get("installation_id")).toBeNull();
      expect(url.searchParams.get("account_id")).toBeNull();
      expect(process.env.PLUGIN_PLATFORM_TEST_GLOBAL_KEY).toBe("must-stay-untouched");
    } finally {
      delete process.env.PLUGIN_PLATFORM_TEST_GLOBAL_KEY;
    }
  });
});
