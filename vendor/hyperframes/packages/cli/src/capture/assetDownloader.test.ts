import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrivateUrl, safeFetch } from "./assetDownloader.js";

describe("isPrivateUrl — SSRF denylist (security: F-003)", () => {
  it("blocks loopback, private, and metadata IPv4", () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/", // cloud metadata
    ]) {
      expect(isPrivateUrl(u), u).toBe(true);
    }
  });

  it("blocks 0.0.0.0 and the 0.0.0.0/8 range", () => {
    expect(isPrivateUrl("http://0.0.0.0/")).toBe(true);
    expect(isPrivateUrl("http://0.1.2.3/")).toBe(true);
  });

  it("blocks IPv6 loopback, IPv4-mapped, ULA, and link-local", () => {
    for (const u of [
      "http://[::1]/",
      "http://[::ffff:169.254.169.254]/", // IPv4-mapped metadata
      "http://[fd00::1]/", // unique-local fc00::/7
      "http://[fe80::1]/", // link-local fe80::/10
    ]) {
      expect(isPrivateUrl(u), u).toBe(true);
    }
  });

  it("still blocks alternate IPv4 encodings (WHATWG canonicalization)", () => {
    expect(isPrivateUrl("http://2130706433/")).toBe(true); // decimal 127.0.0.1
    expect(isPrivateUrl("http://0x7f000001/")).toBe(true); // hex
  });

  it("blocks non-http(s) schemes and internal suffixes", () => {
    expect(isPrivateUrl("file:///etc/passwd")).toBe(true);
    expect(isPrivateUrl("http://db.internal/")).toBe(true);
    expect(isPrivateUrl("http://svc.local/")).toBe(true);
  });

  it("allows ordinary public URLs", () => {
    expect(isPrivateUrl("https://example.com/logo.png")).toBe(false);
    expect(isPrivateUrl("https://cdn.jsdelivr.net/a.svg")).toBe(false);
  });
});

describe("safeFetch — re-validates the denylist on every redirect hop (security: F-002)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blocks a public URL that redirects to a private/metadata host", async () => {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === "https://public.example/logo.png") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      // The metadata host must NEVER be fetched.
      throw new Error(`safeFetch followed a redirect to a private host: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await safeFetch("https://public.example/logo.png");
    expect(res).toBeNull();
    // First (public) hop fetched; the redirect target was rejected before fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a redirect to another public host and returns the final response", async () => {
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === "https://a.example/x")
        return new Response(null, { status: 301, headers: { location: "https://b.example/y" } });
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await safeFetch("https://a.example/x");
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("ok");
  });

  it("returns null when the initial URL is private", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await safeFetch("http://169.254.169.254/");
    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
