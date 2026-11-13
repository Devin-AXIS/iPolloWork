import { describe, expect, test } from "bun:test";

import {
  buildDenAuthUrl,
  createDenClient,
  getDenMcpUrl,
  isLegacyWebAppMcpUrl,
  resolveCloudMcpResourceUrl,
  resolveDenBaseUrls,
} from "../src/app/lib/den";
import { exchangeHandoffAndSignIn } from "../src/app/lib/den-handoff";

test("keeps hosted HTTP API requests and opens the account form over HTTPS", () => {
  expect(resolveDenBaseUrls("http://i.ipollo.ai")).toEqual({
    baseUrl: "http://i.ipollo.ai",
    apiBaseUrl: "http://i.ipollo.ai/api/den",
  });
  const signup = new URL(buildDenAuthUrl("http://i.ipollo.ai", "sign-up"));
  expect(signup.origin).toBe("https://i.ipollo.ai");
  expect(signup.searchParams.get("mode")).toBe("sign-up");
  expect(new URL(buildDenAuthUrl("http://localhost:3100", "sign-in")).origin).toBe("http://localhost:3100");
});

test("retains the configured HTTP API after an HTTPS desktop handoff", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([["ipollowork.den.baseUrl", "http://i.ipollo.ai"]]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: () => true,
    },
  });
  try {
    const client = createDenClient({ baseUrl: "https://i.ipollo.ai" });
    client.exchangeDesktopHandoff = async () => ({ token: "test-session", user: null });
    const result = await exchangeHandoffAndSignIn("test-grant", { baseUrl: "https://i.ipollo.ai", client });
    expect(result).toMatchObject({ ok: true, baseUrl: "http://i.ipollo.ai" });
    expect(values.get("ipollowork.den.authToken")).toBe("test-session");
    expect(values.get("ipollowork.den.baseUrl")).toBe("http://i.ipollo.ai");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

describe("resolveDenBaseUrls", () => {
  test("always derives the API proxy from the base URL", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "https://app.ipolloworklabs.com",
      apiBaseUrl: "https://app.ipolloworklabs.com",
    });
    expect(resolved.apiBaseUrl).toBe("https://app.ipolloworklabs.com/api/den");
  });

  test("ignores an explicit API origin when a base URL is present", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "https://app.ipolloworklabs.com",
      apiBaseUrl: "https://api.example.com",
    });
    expect(resolved.apiBaseUrl).toBe("https://app.ipolloworklabs.com/api/den");
  });

  test("ignores an explicit loopback API URL when a base URL is present", () => {
    const resolved = resolveDenBaseUrls({
      baseUrl: "http://localhost:3000",
      apiBaseUrl: "http://127.0.0.1:8787",
    });
    expect(resolved.apiBaseUrl).toBe("http://localhost:3000/api/den");
  });

  test("derives the /api/den proxy from a web-app baseUrl when no apiBaseUrl is set", () => {
    const resolved = resolveDenBaseUrls({ baseUrl: "https://app.ipolloworklabs.com" });
    expect(resolved.apiBaseUrl).toBe("https://app.ipolloworklabs.com/api/den");
  });
});

describe("getDenMcpUrl", () => {
  test("never targets the bare web-app origin", () => {
    const url = getDenMcpUrl();
    expect(isLegacyWebAppMcpUrl(url)).toBe(false);
    expect(url.endsWith("/mcp")).toBe(true);
  });
});

describe("isLegacyWebAppMcpUrl", () => {
  test("flags the legacy bare web-app MCP URL", () => {
    expect(isLegacyWebAppMcpUrl("https://app.ipolloworklabs.com/mcp")).toBe(true);
    expect(isLegacyWebAppMcpUrl("https://app.ipollowork.software/mcp/")).toBe(true);
  });

  test("accepts valid MCP URLs", () => {
    expect(isLegacyWebAppMcpUrl("https://app.ipolloworklabs.com/api/den/mcp")).toBe(false);
    expect(isLegacyWebAppMcpUrl("http://127.0.0.1:8787/mcp")).toBe(false);
  });

  test("ignores empty or malformed input", () => {
    expect(isLegacyWebAppMcpUrl(null)).toBe(false);
    expect(isLegacyWebAppMcpUrl("not a url")).toBe(false);
  });
});

describe("resolveCloudMcpResourceUrl", () => {
  test("heals a minted legacy web-app resource through the /api/den proxy", () => {
    expect(resolveCloudMcpResourceUrl("https://app.ipolloworklabs.com/mcp")).toBe(
      "https://app.ipolloworklabs.com/api/den/mcp",
    );
    expect(resolveCloudMcpResourceUrl("https://app.ipollowork.software/mcp/")).toBe(
      "https://app.ipollowork.software/api/den/mcp",
    );
  });

  test("keeps healthy resources verbatim", () => {
    expect(resolveCloudMcpResourceUrl("https://app.ipolloworklabs.com/api/den/mcp")).toBe(
      "https://app.ipolloworklabs.com/api/den/mcp",
    );
    expect(resolveCloudMcpResourceUrl("http://127.0.0.1:8787/mcp")).toBe(
      "http://127.0.0.1:8787/mcp",
    );
  });

  test("returns null for unusable resources so callers keep their fallback", () => {
    expect(resolveCloudMcpResourceUrl(null)).toBeNull();
    expect(resolveCloudMcpResourceUrl("")).toBeNull();
    expect(resolveCloudMcpResourceUrl("   ")).toBeNull();
    expect(resolveCloudMcpResourceUrl("not a url")).toBeNull();
    expect(resolveCloudMcpResourceUrl("ftp://app.ipolloworklabs.com/mcp")).toBeNull();
  });
});
