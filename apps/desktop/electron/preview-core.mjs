// preview-core: the shared "fetch a read-only snapshot of the renderer's
// __ipolloworkControl surface" kernel, plus a sanitized public summary.
//
// Consumed by the LAN preview server and (later) the IM bot channel so both
// read the workbench through the same narrowed, whitelisted path. Never
// exposes `execute` — this core is read-only by construction.

const RENDERER_TIMEOUT_MS = 5_000;

// Whitelist of methods the core may invoke on window.__ipolloworkControl.
// HTTP/IM request payloads never select a method; it is fixed by the caller.
const ALLOWED_METHODS = new Set(["snapshot", "actions"]);

function runInRenderer({ getWindow, method }) {
  if (!ALLOWED_METHODS.has(method)) {
    return Promise.resolve({ ok: false, error: "method-not-allowed" });
  }
  // getWindow may return a window directly or a Promise (both are used by
  // callers), so resolve either shape.
  return Promise.resolve()
    .then(() => getWindow())
    .then((win) => {
      if (!win || win.isDestroyed()) {
        throw new Error("renderer-unavailable");
      }
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("renderer-timeout")), RENDERER_TIMEOUT_MS);
      });
      const execution = win.webContents.executeJavaScript(
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
      return Promise.race([execution, timeout]).finally(() => clearTimeout(timeoutId));
    });
}

// Redact values that should never leave the machine (paths, URLs, tokens,
// env-like names). Used to build the public summary for LAN/IM surfaces.
function redactValue(value, key) {
  if (typeof value !== "string") return value;
  if (/token|secret|password|key|auth/i.test(key)) return "••••••";
  return value;
}

// Build a compact, safe summary of a snapshot suitable for an external
// surface (LAN page, IM card). Only whitelisted scalar fields are carried.
export function publicSnapshotSummary(snapshot) {
  const source = snapshot ?? {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      result[key] = redactValue(value, key);
    }
  }
  return result;
}

export function createPreviewCore({ getWindow }) {
  return {
    getSnapshot() {
      return runInRenderer({ getWindow, method: "snapshot" });
    },
    getActions() {
      return runInRenderer({ getWindow, method: "actions" });
    },
    // Returns { ok, summary, actions? } with values redacted for external
    // consumption. Throws if the renderer is unavailable.
    async getPublicSummary() {
      const snapshot = await runInRenderer({ getWindow, method: "snapshot" });
      if (!snapshot?.ok) {
        throw new Error("renderer-unavailable");
      }
      const actions = await runInRenderer({ getWindow, method: "actions" }).catch(() => null);
      return {
        ok: true,
        summary: publicSnapshotSummary(snapshot),
        actions: actions?.ok === true ? actions.actions : [],
      };
    },
  };
}
