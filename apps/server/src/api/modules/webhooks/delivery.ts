import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Webhook delivery: URL admission control, payload signing, and the retry schedule.
 *
 * Everything here is a pure function or takes its side effects by injection
 * (`fetchImpl`, `sleep`, `random`, `now`), because the three things that decide whether
 * this feature is safe — which URLs we agree to fetch, what we sign, and how hard we
 * retry — must be testable without a network, a clock, or a live subscriber.
 */

/* -------------------------------------------------------------------------- */
/* SSRF defence                                                               */
/* -------------------------------------------------------------------------- */

export interface WebhookUrlOptions {
  /**
   * Permits loopback / private / link-local destinations.
   *
   * Local development points webhooks at `http://127.0.0.1:xxxx`, so the escape hatch
   * has to exist; it is opt-in per deployment (`IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE=1`)
   * rather than per request, so a caller cannot ask for it through the API.
   */
  allowPrivate?: boolean;
}

export type WebhookUrlVerdict = { ok: true } | { ok: false; reason: string };

/** Anything longer is rejected before parsing, so a pathological URL cannot be stored. */
export const WEBHOOK_URL_MAX_LENGTH = 2048;

export function webhookPrivateNetworkAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return (env.IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE ?? "").trim() === "1";
}

/**
 * Decides whether the server is willing to send a request to `url`.
 *
 * A webhook URL is attacker-controlled input for a request the server makes from inside
 * the trust boundary, which is the textbook SSRF shape: `http://169.254.169.254/` reads
 * cloud instance credentials, `http://127.0.0.1:4096/` reaches the local engine's own
 * admin surface. So the rule is deny-by-default on address ranges rather than a blocklist
 * of known-bad hostnames.
 *
 * The literal forms an attacker reaches for — `http://0x7f.1`, `http://2130706433`,
 * `http://[::ffff:127.0.0.1]`, `http://127.1` — all normalize to the same address, so the
 * check runs on the parsed host and additionally re-parses it with inet_aton semantics
 * instead of pattern-matching the raw string.
 *
 * IMPORTANT — this does not close DNS rebinding. `evil.example` can pass this check and
 * then resolve to 127.0.0.1 at connect time, or resolve twice with different answers
 * (TOCTOU). Fully closing that needs resolution-time enforcement: resolve the hostname
 * ourselves, validate every returned address, and pin the connection to a validated IP
 * (or run deliveries through an egress proxy that enforces the same table). URL
 * inspection is the first gate, not the whole defence.
 */
export function validateWebhookUrl(url: string, opts: WebhookUrlOptions = {}): WebhookUrlVerdict {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return { ok: false, reason: "missing_url" };
  if (raw.length > WEBHOOK_URL_MAX_LENGTH) return { ok: false, reason: "url_too_long" };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported_scheme" };
  }

  // `http://trusted.example@127.0.0.1/` reads as a trusted host to a human and to any
  // naive prefix check, but connects to the loopback. Credentials in a webhook URL have
  // no legitimate use here anyway, so reject them outright rather than parse around them.
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "userinfo_not_allowed" };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return { ok: false, reason: "missing_host" };

  if (opts.allowPrivate === true) return { ok: true };

  if (isBlockedHostname(hostname)) return { ok: false, reason: "blocked_hostname" };

  const address = parseHostAddress(hostname);
  if (address && isPrivateAddress(address)) {
    return { ok: false, reason: "private_address" };
  }

  return { ok: true };
}

/** Lower-cases and drops the FQDN root dot so `LOCALHOST.` cannot slip past a name check. */
function normalizeHostname(hostname: string): string {
  let value = hostname.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) return value;
  while (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isBlockedHostname(hostname: string): boolean {
  if (hostname === "localhost") return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export interface HostAddress {
  family: 4 | 6;
  /** 4 bytes for IPv4, 16 bytes for IPv6. */
  bytes: number[];
}

/** Parses a host as an IP literal. Returns `null` for a genuine DNS name. */
export function parseHostAddress(hostname: string): HostAddress | null {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const bytes = parseIPv6(hostname.slice(1, -1));
    return bytes ? { family: 6, bytes } : null;
  }
  const v4 = parseIPv4Loose(hostname);
  if (v4) return { family: 4, bytes: v4 };
  // A bare IPv6 literal without brackets is not valid in a URL, but the parser is cheap
  // and this keeps the function usable on hosts that did not come through `new URL`.
  if (hostname.includes(":")) {
    const bytes = parseIPv6(hostname);
    if (bytes) return { family: 6, bytes };
  }
  return null;
}

/**
 * IPv4 parsing with inet_aton semantics: 1–4 dot-separated parts, each decimal, octal
 * (leading `0`) or hex (leading `0x`), with the final part absorbing the remaining bytes.
 *
 * `0x7f.1`, `2130706433` and `0177.0.0.1` are all 127.0.0.1 to a resolver, so they must
 * all be 127.0.0.1 to the check as well.
 */
export function parseIPv4Loose(host: string): number[] | null {
  if (!host || /[^0-9a-fx.]/i.test(host)) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    const value = parseIPv4Part(part);
    if (value === null) return null;
    values.push(value);
  }

  const last = values[values.length - 1];
  if (last === undefined) return null;
  // Each leading part is one byte; the trailing part fills whatever is left.
  const leading = values.slice(0, -1);
  if (leading.some((value) => value > 0xff)) return null;
  const remainingBytes = 4 - leading.length;
  const maxLast = remainingBytes >= 4 ? 0xffffffff : Math.pow(256, remainingBytes) - 1;
  if (last > maxLast) return null;

  const bytes: number[] = [...leading];
  for (let index = remainingBytes - 1; index >= 0; index -= 1) {
    bytes.push(Math.floor(last / Math.pow(256, index)) % 256);
  }
  return bytes.length === 4 ? bytes : null;
}

function parseIPv4Part(part: string): number | null {
  if (part === "") return null;
  const lower = part.toLowerCase();
  let value: number;
  if (lower.startsWith("0x")) {
    const digits = lower.slice(2);
    if (!digits || /[^0-9a-f]/.test(digits)) return null;
    value = Number.parseInt(digits, 16);
  } else if (lower.length > 1 && lower.startsWith("0")) {
    const digits = lower.slice(1);
    if (/[^0-7]/.test(digits)) return null;
    value = Number.parseInt(digits, 8);
  } else {
    if (/[^0-9]/.test(lower)) return null;
    value = Number.parseInt(lower, 10);
  }
  if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
  return value;
}

/** Expands an IPv6 literal (including the `::ffff:127.0.0.1` embedded-IPv4 form) to 16 bytes. */
export function parseIPv6(host: string): number[] | null {
  const value = host.trim().toLowerCase().split("%")[0] ?? "";
  if (!value || /[^0-9a-f:.]/.test(value)) return null;

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const expand = (segment: string): number[] | null => {
    if (segment === "") return [];
    const groups = segment.split(":");
    const bytes: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index] ?? "";
      if (group.includes(".")) {
        // Only legal as the final group.
        if (index !== groups.length - 1) return null;
        const v4 = parseIPv4Loose(group);
        if (!v4) return null;
        bytes.push(...v4);
        continue;
      }
      if (!group || group.length > 4 || /[^0-9a-f]/.test(group)) return null;
      const parsedGroup = Number.parseInt(group, 16);
      bytes.push((parsedGroup >> 8) & 0xff, parsedGroup & 0xff);
    }
    return bytes;
  };

  const head = expand(halves[0] ?? "");
  if (!head) return null;
  if (halves.length === 1) return head.length === 16 ? head : null;

  const tail = expand(halves[1] ?? "");
  if (!tail) return null;
  const fill = 16 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

interface CidrRule {
  bytes: number[];
  prefix: number;
  label: string;
}

/** Address ranges the server refuses to fetch unless the private opt-in is set. */
export const BLOCKED_IPV4_RANGES: readonly CidrRule[] = [
  { bytes: [0, 0, 0, 0], prefix: 8, label: "this-network" },
  { bytes: [10, 0, 0, 0], prefix: 8, label: "private" },
  { bytes: [100, 64, 0, 0], prefix: 10, label: "cgnat" },
  { bytes: [127, 0, 0, 0], prefix: 8, label: "loopback" },
  { bytes: [169, 254, 0, 0], prefix: 16, label: "link-local" },
  { bytes: [172, 16, 0, 0], prefix: 12, label: "private" },
  { bytes: [192, 0, 0, 0], prefix: 24, label: "ietf-protocol" },
  { bytes: [192, 168, 0, 0], prefix: 16, label: "private" },
  { bytes: [198, 18, 0, 0], prefix: 15, label: "benchmark" },
  { bytes: [224, 0, 0, 0], prefix: 4, label: "multicast" },
  { bytes: [240, 0, 0, 0], prefix: 4, label: "reserved" },
];

const IPV6_LOOPBACK = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
const IPV6_UNSPECIFIED = new Array<number>(16).fill(0);
const IPV4_MAPPED_PREFIX = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
const NAT64_PREFIX = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

export function isPrivateAddress(address: HostAddress): boolean {
  if (address.family === 4) {
    return BLOCKED_IPV4_RANGES.some((range) => matchesCidr(address.bytes, range.bytes, range.prefix));
  }

  const bytes = address.bytes;
  if (bytes.length !== 16) return true;
  if (sameBytes(bytes, IPV6_LOOPBACK) || sameBytes(bytes, IPV6_UNSPECIFIED)) return true;
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if (first === 0xff) return true;

  // Addresses that carry an IPv4 address inside them must be judged as that IPv4
  // address, or `::ffff:127.0.0.1` and `2002:7f00:1::` become loopback bypasses.
  const mapped = embeddedIPv4(bytes);
  if (mapped) return isPrivateAddress({ family: 4, bytes: mapped });

  return false;
}

function embeddedIPv4(bytes: number[]): number[] | null {
  if (startsWith(bytes, IPV4_MAPPED_PREFIX)) return bytes.slice(12, 16);
  if (startsWith(bytes, NAT64_PREFIX)) return bytes.slice(12, 16);
  // 2002::/16 (6to4) carries the IPv4 address in bytes 2..5.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  return null;
}

function startsWith(bytes: number[], prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function sameBytes(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => b[index] === value);
}

function matchesCidr(bytes: number[], network: number[], prefix: number): boolean {
  let remaining = prefix;
  for (let index = 0; index < network.length; index += 1) {
    if (remaining <= 0) return true;
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if (((bytes[index] ?? 0) & mask) !== ((network[index] ?? 0) & mask)) return false;
    remaining -= take;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                    */
/* -------------------------------------------------------------------------- */

export const WEBHOOK_SIGNATURE_HEADER = "X-iPolloWork-Signature";
export const WEBHOOK_EVENT_HEADER = "X-iPolloWork-Event";
export const WEBHOOK_DELIVERY_HEADER = "X-iPolloWork-Delivery";
export const WEBHOOK_TIMESTAMP_HEADER = "X-iPolloWork-Timestamp";

/**
 * HMAC-SHA256 over `${timestamp}.${body}`, hex encoded.
 *
 * The timestamp is inside the signed material rather than merely alongside it, so a
 * captured delivery cannot be replayed later with a fresh timestamp: changing the
 * timestamp invalidates the signature. Receivers should reject a delivery whose `t` is
 * outside their tolerance window in addition to checking `v1`.
 */
export function signWebhookPayload(secret: string, body: string, timestamp: number | string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** Renders the `X-iPolloWork-Signature` value: `t=<unix-seconds>,v1=<hex>`. */
export function formatSignatureHeader(timestamp: number | string, signature: string): string {
  return `t=${timestamp},v1=${signature}`;
}

export function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } | null {
  if (typeof header !== "string" || !header.trim()) return null;
  let timestamp = "";
  const signatures: string[] = [];
  for (const segment of header.split(",")) {
    const index = segment.indexOf("=");
    if (index === -1) continue;
    const key = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Receiver-side verification, exported so the SDKs and our own tests check the same way.
 * Comparison is constant time; a length mismatch short-circuits before `timingSafeEqual`,
 * which throws on unequal buffers.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  opts: { toleranceSeconds?: number; now?: () => number } = {},
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const tolerance = opts.toleranceSeconds ?? 300;
  const timestamp = Number(parsed.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (tolerance > 0) {
    const nowSeconds = Math.floor((opts.now?.() ?? Date.now()) / 1000);
    if (Math.abs(nowSeconds - timestamp) > tolerance) return false;
  }

  const expected = Buffer.from(signWebhookPayload(secret, body, parsed.timestamp), "utf8");
  return parsed.signatures.some((candidate) => {
    const actual = Buffer.from(candidate, "utf8");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  });
}

export interface WebhookEnvelope {
  id: string;
  type: string;
  createdAt: number;
  workspaceId?: string;
  webhookId?: string;
  data: unknown;
}

export function buildWebhookEnvelope(input: {
  deliveryId: string;
  event: string;
  data: unknown;
  workspaceId?: string;
  webhookId?: string;
  timestamp?: number;
}): WebhookEnvelope {
  return {
    id: input.deliveryId,
    type: input.event,
    createdAt: input.timestamp ?? Date.now(),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.webhookId ? { webhookId: input.webhookId } : {}),
    data: input.data ?? null,
  };
}

export function buildDeliveryHeaders(input: {
  event: string;
  deliveryId: string;
  body: string;
  secret?: string;
  timestampSeconds: number;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "iPolloWork-Webhooks/1.0",
    [WEBHOOK_EVENT_HEADER]: input.event,
    [WEBHOOK_DELIVERY_HEADER]: input.deliveryId,
    [WEBHOOK_TIMESTAMP_HEADER]: String(input.timestampSeconds),
  };
  if (input.secret) {
    headers[WEBHOOK_SIGNATURE_HEADER] = formatSignatureHeader(
      input.timestampSeconds,
      signWebhookPayload(input.secret, input.body, input.timestampSeconds),
    );
  }
  return headers;
}

/* -------------------------------------------------------------------------- */
/* Retry policy                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Attempt cap, counting the first try. 5 attempts with the schedule below means a
 * subscriber that is down stops being contacted after roughly 15 seconds of wall clock,
 * so one dead endpoint cannot accumulate an unbounded backlog of in-flight retries.
 */
export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_RETRY_BASE_MS = 1_000;
export const WEBHOOK_RETRY_FACTOR = 2;
/** Ceiling on a single backoff. Unreachable at 5 attempts; it bounds future cap changes. */
export const WEBHOOK_RETRY_MAX_DELAY_MS = 30_000;
/** Jitter is +/-20% of the base delay. */
export const WEBHOOK_RETRY_JITTER = 0.2;
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

/** Un-jittered backoff for `attempt` (1-based), before the jitter window is applied. */
export function retryBaseDelay(attempt: number): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(WEBHOOK_RETRY_MAX_DELAY_MS, WEBHOOK_RETRY_BASE_MS * Math.pow(WEBHOOK_RETRY_FACTOR, exponent));
}

/** Inclusive `[min, max]` window a `nextRetryDelay(attempt)` result must fall inside. */
export function retryDelayBounds(attempt: number): { min: number; max: number } {
  const base = retryBaseDelay(attempt);
  return {
    min: Math.round(base * (1 - WEBHOOK_RETRY_JITTER)),
    max: Math.round(base * (1 + WEBHOOK_RETRY_JITTER)),
  };
}

/**
 * Delay in milliseconds before the attempt after `attempt`, or `null` once the cap is hit.
 *
 * Exponential with bounded jitter rather than full jitter: the +/-20% window is wide
 * enough to break up a thundering herd of subscribers retrying in lockstep, and narrow
 * enough that consecutive windows never overlap (1.2x of one attempt is below 0.8x of the
 * next), which keeps the schedule strictly increasing and therefore assertable in a test.
 */
export function nextRetryDelay(
  attempt: number,
  opts: { random?: () => number; maxAttempts?: number } = {},
): number | null {
  const maxAttempts = opts.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
  if (!Number.isFinite(attempt) || attempt < 1) return null;
  if (attempt >= maxAttempts) return null;

  const random = opts.random ?? Math.random;
  const base = retryBaseDelay(attempt);
  const sample = Math.min(1, Math.max(0, random()));
  const factor = 1 - WEBHOOK_RETRY_JITTER + sample * (2 * WEBHOOK_RETRY_JITTER);
  return Math.round(base * factor);
}

/**
 * Retry only what can plausibly succeed later.
 *
 * A 4xx means the subscriber understood the request and rejected it — retrying a 404 or a
 * 401 just hammers an endpoint that will never accept the delivery. The two exceptions are
 * 408 (request timeout) and 429 (rate limited), which explicitly invite a later attempt.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return status >= 500 || status === 0;
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

export interface WebhookDeliveryTarget {
  url: string;
  secret?: string;
  id?: string;
}

export interface WebhookDeliveryAttempt {
  attempt: number;
  status?: number;
  error?: string;
  retryDelayMs?: number;
}

export interface WebhookDeliveryResult {
  deliveryId: string;
  event: string;
  ok: boolean;
  status?: number;
  error?: string;
  attempts: WebhookDeliveryAttempt[];
}

export interface WebhookDeliveryOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  deliveryId?: string;
  /** Aborts the whole delivery, retries included. */
  signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });

/**
 * Sends one event to one subscriber, retrying per the policy above.
 *
 * Never throws: a delivery failure is a reportable outcome, not an exception, because the
 * dispatcher fans out to many subscribers and one unreachable endpoint must not abort the
 * rest. Each attempt carries its own timeout so a subscriber that accepts the connection
 * and then stalls cannot pin a delivery open indefinitely.
 */
export async function deliverWebhook(
  target: WebhookDeliveryTarget,
  event: { type: string; data: unknown; workspaceId?: string },
  opts: WebhookDeliveryOptions = {},
): Promise<WebhookDeliveryResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_DELIVERY_TIMEOUT_MS;
  const maxAttempts = opts.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
  const deliveryId = opts.deliveryId ?? randomUUID();

  const envelope = buildWebhookEnvelope({
    deliveryId,
    event: event.type,
    data: event.data,
    timestamp: now(),
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    ...(target.id ? { webhookId: target.id } : {}),
  });
  const body = JSON.stringify(envelope);

  const attempts: WebhookDeliveryAttempt[] = [];
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (opts.signal?.aborted) {
      attempts.push({ attempt, error: "aborted" });
      return { deliveryId, event: event.type, ok: false, error: "aborted", attempts };
    }

    // The signature timestamp is refreshed per attempt so a retry arriving minutes later
    // is still inside a receiver's replay window.
    const timestampSeconds = Math.floor(now() / 1000);
    const headers = buildDeliveryHeaders({
      event: event.type,
      deliveryId,
      body,
      timestampSeconds,
      ...(target.secret ? { secret: target.secret } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    let status: number | undefined;
    let error: string | undefined;
    try {
      const response = await fetchImpl(target.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
        redirect: "manual",
      });
      status = response.status;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    lastStatus = status;
    lastError = error;

    if (status !== undefined && status >= 200 && status < 300) {
      attempts.push({ attempt, status });
      return { deliveryId, event: event.type, ok: true, status, attempts };
    }

    // A 3xx is not followed: `redirect: "manual"` is what keeps a subscriber from
    // bouncing us to an internal address that the URL check never saw.
    const retryable = status === undefined ? true : isRetryableStatus(status);
    if (!retryable) {
      attempts.push({ attempt, ...(status !== undefined ? { status } : {}), ...(error ? { error } : {}) });
      return {
        deliveryId,
        event: event.type,
        ok: false,
        ...(status !== undefined ? { status } : {}),
        ...(error ? { error } : {}),
        attempts,
      };
    }

    const delay = nextRetryDelay(attempt, {
      maxAttempts,
      ...(opts.random ? { random: opts.random } : {}),
    });
    attempts.push({
      attempt,
      ...(status !== undefined ? { status } : {}),
      ...(error ? { error } : {}),
      ...(delay !== null ? { retryDelayMs: delay } : {}),
    });
    if (delay === null) break;
    await sleep(delay);
  }

  return {
    deliveryId,
    event: event.type,
    ok: false,
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    ...(lastError ? { error: lastError } : {}),
    attempts,
  };
}
