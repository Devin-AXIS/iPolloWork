import { randomUUID } from "node:crypto";
import { SuiteError } from "./errors.ts";

export function hasEnterpriseDesktop(): boolean {
  return process.env.IPOLLOWORK_DESKTOP_VAULT === "1" && process.connected === true;
}

const pending = new Map<string, (ok: boolean, value?: unknown) => void>();
function receive(message: unknown) {
  if (typeof message !== "object" || message === null || !("type" in message)
    || message.type !== "ipollo-enterprise-desktop-result" || !("id" in message) || typeof message.id !== "string") return;
  pending.get(message.id)?.("ok" in message && message.ok === true, "value" in message ? message.value : undefined);
}
function disconnected() {
  for (const finish of pending.values()) finish(false);
}

/** This channel goes to the desktop parent. It is never served to the renderer. */
export async function desktopEnterprise(operation: "seal" | "unseal" | "open" | "close" | "clear", value?: unknown): Promise<unknown> {
  if (!hasEnterpriseDesktop() || !process.send) throw new SuiteError("IPW_DESKTOP_REQUIRED", 503);
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const fail = () => finish(false);
    const timeout = setTimeout(fail, 30_000);
    timeout.unref();
    function finish(ok: boolean, result?: unknown) {
      clearTimeout(timeout);
      if (!pending.delete(id)) return;
      if (!pending.size) {
        process.off("message", receive);
        process.off("disconnect", disconnected);
      }
      if (ok) resolve(result);
      else reject(new SuiteError(operation === "open" ? "IPW_ORGANIZATION_BROWSER_UNAVAILABLE" : "IPW_DESKTOP_VAULT_UNAVAILABLE", 503));
    }
    if (!pending.size) {
      process.on("message", receive);
      process.once("disconnect", disconnected);
    }
    pending.set(id, finish);
    process.send?.({ type: "ipollo-enterprise-desktop", id, operation, value }, error => { if (error) fail(); });
  });
}
