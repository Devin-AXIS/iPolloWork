// LAN read-only preview server: pair-code → session token → read-only
// snapshot of the renderer's __ipolloworkControl surface, served to
// mobile devices on the local network. Zero third-party dependencies.
//
// Security posture (read-only by construction):
//   - Default OFF; only started when the user enables it in settings.
//   - 6-digit pair code (10 min TTL, single-use) exchanged for an in-memory
//     session token (12 h TTL, cleared on disable/quit).
//   - One-time challenge issued with the pairing page to blunt CSRF / drive-by
//     browser brute-forcing of the pair endpoint.
//   - Per-IP fail lockout + sliding-window rate limit on /pair.
//   - Only snapshot()/listActions() are ever bridged to the renderer; the
//     /api/execute route is hard-rejected with 403 (read-only mode).
import { randomBytes, randomInt } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const CODE_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 30 * 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const DEFAULT_PORT = 39485;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(html);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 128_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be JSON"));
      }
    });
    request.on("error", reject);
  });
}

function lanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const address of interfaces[name] ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        out.push(address.address);
      }
    }
  }
  return out;
}

export function createLanPreviewServer({ appName, getWindow, pageHtmlPath, log = () => {} }) {
  let server = null;
  let port = 0;
  let code = null;
  let codeExpiresAt = 0;
  const challenges = new Map();
  const sessions = new Map();
  const fails = new Map();
  const hits = new Map();

  const randHex = (n) => randomBytes(n).toString("hex");

  function generateCode() {
    code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    codeExpiresAt = Date.now() + CODE_TTL_MS;
    return { code, expiresAt: codeExpiresAt };
  }

  function validCode(input) {
    return code !== null && typeof input === "string" && input === code && Date.now() < codeExpiresAt;
  }

  function issueSession(ip) {
    const token = randHex(32);
    sessions.set(token, { ip, issuedAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
    return { token, expiresAt: Date.now() + SESSION_TTL_MS };
  }

  function authorized(request) {
    const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? "");
    if (!match) return null;
    const session = sessions.get(match[1]);
    if (!session || Date.now() >= session.expiresAt) {
      sessions.delete(match[1]);
      return null;
    }
    return session;
  }

  function rateLimited(ip) {
    const now = Date.now();
    const window = (hits.get(ip) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
    if (window.length >= RATE_MAX) {
      hits.set(ip, window);
      return true;
    }
    window.push(now);
    hits.set(ip, window);
    return false;
  }

  function registerFail(ip) {
    const current = fails.get(ip) ?? { count: 0, lockedUntil: 0 };
    if (Date.now() < current.lockedUntil) return;
    current.count += 1;
    if (current.count >= MAX_FAILS) {
      current.count = 0;
      current.lockedUntil = Date.now() + LOCK_MS;
    }
    fails.set(ip, current);
  }

  function lockRemainingFor(ip) {
    const current = fails.get(ip);
    if (!current) return 0;
    const remaining = current.lockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  async function invokeRenderer(method) {
    const win = await getWindow();
    if (!win || win.isDestroyed()) {
      throw new Error("renderer-unavailable");
    }
    return win.webContents.executeJavaScript(
      `(async () => {
        const control = window.__ipolloworkControl;
        if (!control) return { ok: false, error: "control-surface-unavailable" };
        control.setEnabled?.(true);
        if (${JSON.stringify(method)} === "snapshot") return { ok: true, ...control.snapshot() };
        if (${JSON.stringify(method)} === "actions") return { ok: true, actions: control.listActions() };
        return { ok: false, error: "unknown-method" };
      })()`,
      true,
    );
  }

  async function handle(request, response) {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const ip = request.socket.remoteAddress ?? "";

    try {
      if (request.method === "GET" && url.pathname === "/") {
        const challenge = randHex(16);
        challenges.set(challenge, { expiresAt: Date.now() + CHALLENGE_TTL_MS, used: false });
        const html = (await import("node:fs/promises")).readFile(pageHtmlPath, "utf8")
          .then((raw) => raw.replace("__CHALLENGE__", challenge))
          .catch(() => `<h1>Preview page missing</h1>`);
        sendHtml(response, await html);
        return;
      }

      if (request.method === "POST" && url.pathname === "/pair") {
        if (rateLimited(ip)) {
          sendJson(response, 429, { ok: false, error: "too-many-requests" });
          return;
        }
        if (lockRemainingFor(ip) > 0) {
          sendJson(response, 429, { ok: false, error: "locked", retryAfterMs: lockRemainingFor(ip) });
          return;
        }
        let body;
        try {
          body = await readBody(request);
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "bad-request" });
          return;
        }
        const challenge = challenges.get(body?.challenge);
        if (!challenge || challenge.used || Date.now() > challenge.expiresAt) {
          sendJson(response, 401, { ok: false, error: "challenge-invalid" });
          return;
        }
        if (!validCode(body?.code)) {
          registerFail(ip);
          sendJson(response, 401, { ok: false, error: "code-invalid", retryAfterMs: lockRemainingFor(ip) });
          return;
        }
        challenge.used = true;
        code = null;
        sendJson(response, 200, { ok: true, ...issueSession(ip) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true, app: appName, paired: sessions.size > 0 });
        return;
      }

      if (request.method === "GET" && (url.pathname === "/api/snapshot" || url.pathname === "/api/actions")) {
        if (!authorized(request)) {
          sendJson(response, 401, { ok: false, error: "unauthorized" });
          return;
        }
        const method = url.pathname === "/api/snapshot" ? "snapshot" : "actions";
        try {
          sendJson(response, 200, await invokeRenderer(method));
        } catch (error) {
          sendJson(response, 503, {
            ok: false,
            error: error instanceof Error ? error.message : "renderer-unavailable",
          });
        }
        return;
      }

      if (url.pathname.startsWith("/api/execute")) {
        sendJson(response, 403, { ok: false, error: "read-only-mode" });
        return;
      }

      sendJson(response, 404, { ok: false, error: "not-found" });
    } catch (error) {
      log(`lan-preview error: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(response, 500, { ok: false, error: "internal-error" });
    }
  }

  return {
    async start(preferredPort) {
      if (server) throw new Error("lan-preview already running");
      server = createServer(handle);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(preferredPort ?? DEFAULT_PORT, "0.0.0.0", () => resolve(undefined));
      });
      port = server.address().port;
      const generated = generateCode();
      log(`LAN preview listening on 0.0.0.0:${port}`);
      return { port, code: generated.code, codeExpiresAt: generated.expiresAt };
    },
    async stop() {
      if (!server) return;
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      server = null;
      port = 0;
      code = null;
      codeExpiresAt = 0;
      challenges.clear();
      sessions.clear();
      fails.clear();
      hits.clear();
    },
    regenerateCode() {
      if (!server) return null;
      const generated = generateCode();
      return { code: generated.code, expiresAt: generated.expiresAt };
    },
    disconnectAll() {
      sessions.clear();
      challenges.clear();
    },
    getState() {
      return {
        enabled: !!server,
        port,
        addresses: lanAddresses(),
        code,
        codeExpiresAt,
        sessionCount: sessions.size,
        pendingChallengeCount: challenges.size,
      };
    },
  };
}

export function defaultLanPreviewPort() {
  return DEFAULT_PORT;
}

export function lanPreviewPagePath(desktopRoot) {
  return path.join(desktopRoot, "resources", "lan-preview", "index.html");
}
