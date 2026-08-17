import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  buildDeliveryHeaders,
  buildWebhookEnvelope,
  deliverWebhook,
  formatSignatureHeader,
  isPrivateAddress,
  isRetryableStatus,
  nextRetryDelay,
  parseHostAddress,
  parseIPv4Loose,
  parseIPv6,
  parseSignatureHeader,
  retryBaseDelay,
  retryDelayBounds,
  signWebhookPayload,
  validateWebhookUrl,
  verifyWebhookSignature,
  webhookPrivateNetworkAllowed,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_URL_MAX_LENGTH,
} from "./delivery.js";

/* -------------------------------------------------------------------------- */
/* Signing                                                                    */
/* -------------------------------------------------------------------------- */

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ id: "evt_1", type: "task.created" });

describe("signWebhookPayload", () => {
  test("matches known vectors", () => {
    expect(signWebhookPayload(SECRET, BODY, 1700000000))
      .toBe("9c2f3b2f113eb39ef7e2df861efff0663645d7334d81d8997777b6645360c976");
    expect(signWebhookPayload(SECRET, "", 0))
      .toBe("e359a4b07054a77815d22548b11f4936e8b16e4160347fcbc7fbeac890d07c42");
    expect(signWebhookPayload(SECRET, "{}", 1735689600))
      .toBe("5e4324d9a545f78e160b07f1c6d30e488e7c0e72b215d0bebccd42ef80422b09");
  });

  test("signs exactly `${timestamp}.${body}`", () => {
    // Spelled out literally, independent of the implementation's template literal, so a
    // change to the signed material (separator, order, encoding) fails here.
    const expected = createHmac("sha256", SECRET)
      .update('1700000000.{"id":"evt_1","type":"task.created"}', "utf8")
      .digest("hex");
    expect(signWebhookPayload(SECRET, BODY, 1700000000)).toBe(expected);
  });

  test("a one second timestamp change produces a different signature", () => {
    expect(signWebhookPayload(SECRET, BODY, 1700000001))
      .toBe("f55885b5fdb22257ebc7c34ac5ef802210dfa9691dbd48032ab1a6aac1c47d2e");
    expect(signWebhookPayload(SECRET, BODY, 1700000001)).not.toBe(signWebhookPayload(SECRET, BODY, 1700000000));
  });

  test("a different secret produces a different signature", () => {
    expect(signWebhookPayload("another_secret", BODY, 1700000000))
      .toBe("f21043bee06c3d8dba925b9b065310187e5b3a66ebec96303a4000f519b278ec");
  });

  test("a numeric and string timestamp are the same input", () => {
    expect(signWebhookPayload(SECRET, BODY, "1700000000")).toBe(signWebhookPayload(SECRET, BODY, 1700000000));
  });

  test("output is 64 hex characters", () => {
    expect(signWebhookPayload(SECRET, BODY, 1700000000)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("signature header", () => {
  test("formats as t=<ts>,v1=<hex>", () => {
    expect(formatSignatureHeader(1700000000, "abc")).toBe("t=1700000000,v1=abc");
  });

  test("round-trips through the parser", () => {
    const header = formatSignatureHeader(1700000000, signWebhookPayload(SECRET, BODY, 1700000000));
    expect(parseSignatureHeader(header)).toEqual({
      timestamp: "1700000000",
      signatures: ["9c2f3b2f113eb39ef7e2df861efff0663645d7334d81d8997777b6645360c976"],
    });
  });

  test("accepts multiple v1 values and tolerates whitespace", () => {
    expect(parseSignatureHeader("t=1, v1=aa, v1=bb")).toEqual({ timestamp: "1", signatures: ["aa", "bb"] });
  });

  test("rejects a header with no timestamp or no signature", () => {
    expect(parseSignatureHeader("v1=aa")).toBeNull();
    expect(parseSignatureHeader("t=1")).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  const now = () => 1700000000_000;
  const header = formatSignatureHeader(1700000000, signWebhookPayload(SECRET, BODY, 1700000000));

  test("accepts a genuine signature", () => {
    expect(verifyWebhookSignature(SECRET, BODY, header, { now })).toBe(true);
  });

  test("rejects a tampered body", () => {
    expect(verifyWebhookSignature(SECRET, `${BODY} `, header, { now })).toBe(false);
  });

  test("rejects the wrong secret", () => {
    expect(verifyWebhookSignature("nope_nope_nope_16", BODY, header, { now })).toBe(false);
  });

  test("rejects a replay outside the tolerance window", () => {
    const late = () => 1700000000_000 + 3600_000;
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: late })).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: late, toleranceSeconds: 7200 })).toBe(true);
  });

  test("rejects a signature moved to a different timestamp", () => {
    const forged = formatSignatureHeader(
      1700000001,
      signWebhookPayload(SECRET, BODY, 1700000000),
    );
    expect(verifyWebhookSignature(SECRET, BODY, forged, { now })).toBe(false);
  });

  test("a truncated signature does not throw on the constant-time compare", () => {
    expect(verifyWebhookSignature(SECRET, BODY, "t=1700000000,v1=9c2f", { now })).toBe(false);
  });
});

describe("buildDeliveryHeaders", () => {
  const headers = buildDeliveryHeaders({
    event: "task.created",
    deliveryId: "d-1",
    body: BODY,
    secret: SECRET,
    timestampSeconds: 1700000000,
  });

  test("carries event, delivery id and timestamp", () => {
    expect(headers[WEBHOOK_EVENT_HEADER]).toBe("task.created");
    expect(headers[WEBHOOK_DELIVERY_HEADER]).toBe("d-1");
    expect(headers[WEBHOOK_TIMESTAMP_HEADER]).toBe("1700000000");
    expect(headers["content-type"]).toBe("application/json");
  });

  test("carries a verifiable signature", () => {
    expect(headers[WEBHOOK_SIGNATURE_HEADER])
      .toBe("t=1700000000,v1=9c2f3b2f113eb39ef7e2df861efff0663645d7334d81d8997777b6645360c976");
    expect(verifyWebhookSignature(SECRET, BODY, headers[WEBHOOK_SIGNATURE_HEADER] ?? "", {
      now: () => 1700000000_000,
    })).toBe(true);
  });

  test("omits the signature when there is no secret", () => {
    const unsigned = buildDeliveryHeaders({
      event: "task.created",
      deliveryId: "d-1",
      body: BODY,
      timestampSeconds: 1700000000,
    });
    expect(unsigned[WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();
  });
});

describe("buildWebhookEnvelope", () => {
  test("carries the delivery id, type and data", () => {
    expect(buildWebhookEnvelope({
      deliveryId: "d-1",
      event: "task.created",
      data: { taskId: "t1" },
      workspaceId: "w1",
      webhookId: "h1",
      timestamp: 1700000000_000,
    })).toEqual({
      id: "d-1",
      type: "task.created",
      createdAt: 1700000000_000,
      workspaceId: "w1",
      webhookId: "h1",
      data: { taskId: "t1" },
    });
  });

  test("omits optional ids and normalizes missing data to null", () => {
    expect(buildWebhookEnvelope({ deliveryId: "d", event: "e", data: undefined, timestamp: 1 }))
      .toEqual({ id: "d", type: "e", createdAt: 1, data: null });
  });
});

/* -------------------------------------------------------------------------- */
/* SSRF                                                                       */
/* -------------------------------------------------------------------------- */

describe("validateWebhookUrl", () => {
  const blocked: Array<[string, string]> = [
    // Scheme
    ["file:///etc/passwd", "unsupported_scheme"],
    ["javascript:alert(1)", "unsupported_scheme"],
    ["ftp://example.com/hook", "unsupported_scheme"],
    ["gopher://example.com:70/_", "unsupported_scheme"],
    // Malformed
    ["", "missing_url"],
    ["   ", "missing_url"],
    ["not a url", "invalid_url"],
    ["https://", "invalid_url"],
    // Userinfo smuggling: the host a human reads is not the host we would connect to.
    ["http://evil@127.0.0.1/hook", "userinfo_not_allowed"],
    ["https://hooks.example.com@127.0.0.1/hook", "userinfo_not_allowed"],
    ["http://user:pass@example.com/hook", "userinfo_not_allowed"],
    // Loopback, in every encoding a resolver accepts.
    ["http://127.0.0.1/hook", "private_address"],
    ["http://127.0.0.1:9999/hook", "private_address"],
    ["http://127.1/hook", "private_address"],
    ["http://0x7f.1/hook", "private_address"],
    ["http://0x7f000001/hook", "private_address"],
    ["http://2130706433/hook", "private_address"],
    ["http://0177.0.0.1/hook", "private_address"],
    ["http://127.0.0.254/hook", "private_address"],
    // Named loopback.
    ["http://localhost/hook", "blocked_hostname"],
    ["http://localhost:4096/hook", "blocked_hostname"],
    ["http://LOCALHOST./hook", "blocked_hostname"],
    ["http://api.localhost/hook", "blocked_hostname"],
    ["http://printer.local/hook", "blocked_hostname"],
    ["http://svc.internal/hook", "blocked_hostname"],
    // IPv6 loopback and its equivalents.
    ["http://[::1]/hook", "private_address"],
    ["http://[0:0:0:0:0:0:0:1]/hook", "private_address"],
    ["http://[::ffff:127.0.0.1]/hook", "private_address"],
    ["http://[::ffff:7f00:1]/hook", "private_address"],
    ["http://[::]/hook", "private_address"],
    ["http://[2002:7f00:1::]/hook", "private_address"],
    ["http://[64:ff9b::7f00:1]/hook", "private_address"],
    // IPv6 private / link-local / multicast.
    ["http://[fd00::1]/hook", "private_address"],
    ["http://[fc00::1]/hook", "private_address"],
    ["http://[fe80::1]/hook", "private_address"],
    ["http://[ff02::1]/hook", "private_address"],
    // RFC1918 and friends.
    ["http://10.0.0.1/hook", "private_address"],
    ["http://10.255.255.255/hook", "private_address"],
    ["http://172.16.0.1/hook", "private_address"],
    ["http://172.31.255.255/hook", "private_address"],
    ["http://192.168.1.1/hook", "private_address"],
    ["http://100.64.0.1/hook", "private_address"],
    // Cloud metadata — the single highest-value SSRF target.
    ["http://169.254.169.254/latest/meta-data/iam/security-credentials/", "private_address"],
    ["http://169.254.170.2/v2/credentials", "private_address"],
    // 0.0.0.0 is a loopback alias on Linux.
    ["http://0.0.0.0/hook", "private_address"],
    ["http://0/hook", "private_address"],
    // Multicast / reserved / broadcast.
    ["http://224.0.0.1/hook", "private_address"],
    ["http://255.255.255.255/hook", "private_address"],
  ];

  for (const [url, reason] of blocked) {
    test(`rejects ${JSON.stringify(url)} (${reason})`, () => {
      expect(validateWebhookUrl(url)).toEqual({ ok: false, reason });
    });
  }

  const allowed = [
    "https://hooks.example.com/ingest",
    "http://hooks.example.com:8080/ingest",
    "https://example.com./ingest",
    "https://8.8.8.8/ingest",
    "https://11.0.0.1/ingest",
    // Boundaries either side of 172.16.0.0/12.
    "https://172.15.255.255/ingest",
    "https://172.32.0.1/ingest",
    // Boundaries either side of 100.64.0.0/10.
    "https://100.63.255.255/ingest",
    "https://100.128.0.1/ingest",
    "https://[2606:4700:4700::1111]/ingest",
    "https://xn--r8jz45g.jp/ingest",
    "https://例え.jp/ingest",
    "https://hooks.example.com/ingest?token=abc#frag",
  ];

  for (const url of allowed) {
    test(`allows ${JSON.stringify(url)}`, () => {
      expect(validateWebhookUrl(url)).toEqual({ ok: true });
    });
  }

  test("rejects a url past the length cap before parsing", () => {
    const url = `https://example.com/${"a".repeat(WEBHOOK_URL_MAX_LENGTH)}`;
    expect(validateWebhookUrl(url)).toEqual({ ok: false, reason: "url_too_long" });
  });

  test("allowPrivate opens loopback for local development", () => {
    expect(validateWebhookUrl("http://127.0.0.1:3000/hook", { allowPrivate: true })).toEqual({ ok: true });
    expect(validateWebhookUrl("http://localhost:3000/hook", { allowPrivate: true })).toEqual({ ok: true });
    expect(validateWebhookUrl("http://[::1]:3000/hook", { allowPrivate: true })).toEqual({ ok: true });
  });

  test("allowPrivate does not open non-http schemes or userinfo", () => {
    expect(validateWebhookUrl("file:///etc/passwd", { allowPrivate: true }))
      .toEqual({ ok: false, reason: "unsupported_scheme" });
    expect(validateWebhookUrl("http://evil@127.0.0.1/", { allowPrivate: true }))
      .toEqual({ ok: false, reason: "userinfo_not_allowed" });
  });

  test("a public hostname passes even though it could still rebind to a private address", () => {
    // Documents the known gap: this check is on the URL, not on the resolved address.
    expect(validateWebhookUrl("https://rebind.example.com/hook")).toEqual({ ok: true });
  });
});

describe("webhookPrivateNetworkAllowed", () => {
  test("is opt-in and exact", () => {
    expect(webhookPrivateNetworkAllowed({})).toBe(false);
    expect(webhookPrivateNetworkAllowed({ IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE: "0" })).toBe(false);
    expect(webhookPrivateNetworkAllowed({ IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE: "true" })).toBe(false);
    expect(webhookPrivateNetworkAllowed({ IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE: "1" })).toBe(true);
    expect(webhookPrivateNetworkAllowed({ IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE: " 1 " })).toBe(true);
  });
});

describe("parseIPv4Loose", () => {
  test("accepts every inet_aton form of 127.0.0.1", () => {
    for (const form of ["127.0.0.1", "127.1", "0x7f.1", "0x7f000001", "2130706433", "0177.0.0.1"]) {
      expect(parseIPv4Loose(form)).toEqual([127, 0, 0, 1]);
    }
  });

  test("rejects out-of-range and over-long forms", () => {
    expect(parseIPv4Loose("256.1.1.1")).toBeNull();
    expect(parseIPv4Loose("1.2.3.256")).toBeNull();
    expect(parseIPv4Loose("1.2.3.4.5")).toBeNull();
    expect(parseIPv4Loose("0900.1.1.1")).toBeNull();
    expect(parseIPv4Loose("")).toBeNull();
  });

  test("rejects hostnames", () => {
    expect(parseIPv4Loose("example.com")).toBeNull();
    expect(parseIPv4Loose("beef.cafe")).toBeNull();
    expect(parseIPv4Loose("0xdead.0xbeef")).toBeNull();
  });
});

describe("parseIPv6", () => {
  test("expands compressed forms", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::")).toEqual(new Array<number>(16).fill(0));
    expect(parseIPv6("0:0:0:0:0:0:0:1")).toEqual(parseIPv6("::1"));
  });

  test("expands an embedded IPv4 tail", () => {
    expect(parseIPv6("::ffff:127.0.0.1")?.slice(10)).toEqual([0xff, 0xff, 127, 0, 0, 1]);
  });

  test("drops a zone id and rejects garbage", () => {
    expect(parseIPv6("fe80::1%eth0")?.slice(0, 2)).toEqual([0xfe, 0x80]);
    expect(parseIPv6("::1::2")).toBeNull();
    expect(parseIPv6("gg::1")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7")).toBeNull();
  });
});

describe("parseHostAddress / isPrivateAddress", () => {
  test("a dns name is not an address", () => {
    expect(parseHostAddress("hooks.example.com")).toBeNull();
  });

  test("classifies the boundaries of each blocked v4 range", () => {
    const isPrivate = (host: string) => {
      const address = parseHostAddress(host);
      return address ? isPrivateAddress(address) : null;
    };
    expect(isPrivate("9.255.255.255")).toBe(false);
    expect(isPrivate("10.0.0.0")).toBe(true);
    expect(isPrivate("11.0.0.0")).toBe(false);
    expect(isPrivate("172.15.255.255")).toBe(false);
    expect(isPrivate("172.16.0.0")).toBe(true);
    expect(isPrivate("172.31.255.255")).toBe(true);
    expect(isPrivate("172.32.0.0")).toBe(false);
    expect(isPrivate("192.167.255.255")).toBe(false);
    expect(isPrivate("192.168.0.0")).toBe(true);
    expect(isPrivate("169.253.255.255")).toBe(false);
    expect(isPrivate("169.254.0.0")).toBe(true);
    expect(isPrivate("126.255.255.255")).toBe(false);
    expect(isPrivate("127.0.0.0")).toBe(true);
    expect(isPrivate("128.0.0.0")).toBe(false);
  });

  test("classifies bracketed v6 literals", () => {
    expect(isPrivateAddress(parseHostAddress("[::1]")!)).toBe(true);
    expect(isPrivateAddress(parseHostAddress("[2606:4700::1111]")!)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Retry policy                                                               */
/* -------------------------------------------------------------------------- */

describe("nextRetryDelay", () => {
  test("doubles the base delay per attempt", () => {
    expect([1, 2, 3, 4].map((attempt) => retryBaseDelay(attempt))).toEqual([1000, 2000, 4000, 8000]);
  });

  test("stops after the attempt cap", () => {
    expect(nextRetryDelay(WEBHOOK_MAX_ATTEMPTS - 1)).not.toBeNull();
    expect(nextRetryDelay(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
    expect(nextRetryDelay(WEBHOOK_MAX_ATTEMPTS + 5)).toBeNull();
    expect(nextRetryDelay(1, { maxAttempts: 1 })).toBeNull();
  });

  test("rejects a nonsensical attempt number", () => {
    expect(nextRetryDelay(0)).toBeNull();
    expect(nextRetryDelay(Number.NaN)).toBeNull();
  });

  test("every sample lands inside the declared bounds", () => {
    for (let attempt = 1; attempt < WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
      const { min, max } = retryDelayBounds(attempt);
      for (let i = 0; i < 200; i += 1) {
        const delay = nextRetryDelay(attempt);
        expect(delay).not.toBeNull();
        expect(delay!).toBeGreaterThanOrEqual(min);
        expect(delay!).toBeLessThanOrEqual(max);
      }
    }
  });

  test("the jitter windows never overlap, so the schedule is strictly increasing", () => {
    for (let attempt = 1; attempt < WEBHOOK_MAX_ATTEMPTS - 1; attempt += 1) {
      expect(retryDelayBounds(attempt).max).toBeLessThan(retryDelayBounds(attempt + 1).min);
    }
    // Which means any two consecutive samples are ordered, whatever the randomness does.
    for (let attempt = 1; attempt < WEBHOOK_MAX_ATTEMPTS - 1; attempt += 1) {
      for (let i = 0; i < 50; i += 1) {
        expect(nextRetryDelay(attempt)!).toBeLessThan(nextRetryDelay(attempt + 1)!);
      }
    }
  });

  test("jitter actually spreads the delay", () => {
    expect(nextRetryDelay(1, { random: () => 0 })).toBe(800);
    expect(nextRetryDelay(1, { random: () => 0.5 })).toBe(1000);
    expect(nextRetryDelay(1, { random: () => 1 })).toBe(1200);
    // An out-of-contract random source is clamped rather than producing a wild delay.
    expect(nextRetryDelay(1, { random: () => -5 })).toBe(800);
    expect(nextRetryDelay(1, { random: () => 5 })).toBe(1200);
  });

  test("the total retry window is bounded", () => {
    let total = 0;
    for (let attempt = 1; attempt < WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
      total += retryDelayBounds(attempt).max;
    }
    expect(total).toBeLessThanOrEqual(20_000);
  });
});

describe("isRetryableStatus", () => {
  test("retries 5xx and transport failures", () => {
    for (const status of [0, 500, 502, 503, 504]) expect(isRetryableStatus(status)).toBe(true);
  });

  test("retries only 408 and 429 out of the 4xx family", () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    for (const status of [400, 401, 403, 404, 405, 409, 410, 418, 422, 451]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  test("does not retry a 2xx or 3xx", () => {
    for (const status of [200, 204, 301, 302, 307]) expect(isRetryableStatus(status)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

interface FetchCall {
  url: string;
  init: RequestInit;
}

function recordingFetch(responses: Array<number | Error>) {
  const calls: FetchCall[] = [];
  let index = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return new Response(null, { status: next ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const noSleep = async () => {};
const fixedNow = () => 1700000000_000;

describe("deliverWebhook", () => {
  test("posts a signed body and reports success on the first attempt", async () => {
    const { impl, calls } = recordingFetch([200]);
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x", secret: SECRET, id: "h1" },
      { type: "task.created", data: { taskId: "t1" }, workspaceId: "w1" },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow, deliveryId: "d-1" },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.deliveryId).toBe("d-1");
    expect(result.attempts).toEqual([{ attempt: 1, status: 200 }]);
    expect(calls).toHaveLength(1);

    const call = calls[0]!;
    expect(call.url).toBe("https://hooks.example.com/x");
    expect(call.init.method).toBe("POST");
    // A subscriber must not be able to bounce us to an internal address.
    expect(call.init.redirect).toBe("manual");

    const headers = call.init.headers as Record<string, string>;
    expect(headers[WEBHOOK_EVENT_HEADER]).toBe("task.created");
    expect(headers[WEBHOOK_DELIVERY_HEADER]).toBe("d-1");

    const body = String(call.init.body);
    expect(JSON.parse(body)).toEqual({
      id: "d-1",
      type: "task.created",
      createdAt: 1700000000_000,
      workspaceId: "w1",
      webhookId: "h1",
      data: { taskId: "t1" },
    });
    expect(verifyWebhookSignature(SECRET, body, headers[WEBHOOK_SIGNATURE_HEADER] ?? "", { now: fixedNow }))
      .toBe(true);
  });

  test("omits the signature header when the subscription has no secret", async () => {
    const { impl, calls } = recordingFetch([200]);
    await deliverWebhook(
      { url: "https://hooks.example.com/x" },
      { type: "session.idle", data: {} },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow },
    );
    expect((calls[0]!.init.headers as Record<string, string>)[WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();
  });

  test("retries a 500 and succeeds", async () => {
    const { impl, calls } = recordingFetch([500, 503, 200]);
    const slept: number[] = [];
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x", secret: SECRET },
      { type: "task.failed", data: {} },
      {
        fetchImpl: impl,
        now: fixedNow,
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([500, 503, 200]);
    expect(slept).toHaveLength(2);
    expect(slept[0]!).toBeLessThan(slept[1]!);
  });

  test("retries a transport failure", async () => {
    const { impl, calls } = recordingFetch([new Error("ECONNREFUSED"), 200]);
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x" },
      { type: "task.created", data: {} },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow },
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(result.attempts[0]!.error).toBe("ECONNREFUSED");
  });

  test("gives up immediately on a 404 rather than hammering a dead endpoint", async () => {
    const { impl, calls } = recordingFetch([404]);
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/gone" },
      { type: "task.created", data: {} },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow },
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  test("does not follow a redirect", async () => {
    const { impl, calls } = recordingFetch([302]);
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x" },
      { type: "task.created", data: {} },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow },
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(calls).toHaveLength(1);
  });

  test("retries a 429 and a 408", async () => {
    for (const status of [429, 408]) {
      const { impl, calls } = recordingFetch([status, 200]);
      const result = await deliverWebhook(
        { url: "https://hooks.example.com/x" },
        { type: "task.created", data: {} },
        { fetchImpl: impl, sleep: noSleep, now: fixedNow },
      );
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(2);
    }
  });

  test("stops at the attempt cap", async () => {
    const { impl, calls } = recordingFetch([500]);
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x" },
      { type: "task.created", data: {} },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow },
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(calls).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    expect(result.attempts).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    // The last attempt has nothing scheduled after it.
    expect(result.attempts[WEBHOOK_MAX_ATTEMPTS - 1]!.retryDelayMs).toBeUndefined();
  });

  test("maxAttempts of 1 is a single shot, as the test endpoint uses", async () => {
    const { impl, calls } = recordingFetch([500]);
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x" },
      { type: "webhook.test", data: {} },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow, maxAttempts: 1 },
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("aborts an attempt that exceeds the per-delivery timeout", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true });
      })) as unknown as typeof fetch;

    const result = await deliverWebhook(
      { url: "https://hooks.example.com/slow" },
      { type: "task.created", data: {} },
      { fetchImpl: hanging, sleep: noSleep, now: fixedNow, timeoutMs: 5, maxAttempts: 2 },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timed out");
    expect(result.attempts).toHaveLength(2);
  });

  test("an already-aborted caller signal stops before any request", async () => {
    const { impl, calls } = recordingFetch([200]);
    const controller = new AbortController();
    controller.abort();
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x" },
      { type: "task.created", data: {} },
      { fetchImpl: impl, sleep: noSleep, now: fixedNow, signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("aborted");
    expect(calls).toHaveLength(0);
  });

  test("never throws, whatever the transport does", async () => {
    const exploding = (() => {
      throw new Error("synchronous boom");
    }) as unknown as typeof fetch;
    const result = await deliverWebhook(
      { url: "https://hooks.example.com/x" },
      { type: "task.created", data: {} },
      { fetchImpl: exploding, sleep: noSleep, now: fixedNow, maxAttempts: 2 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("synchronous boom");
  });
});
