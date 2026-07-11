import { getMcpServerName, type McpDirectoryInfo } from "../../../app/constants";

const EXTENSION_DISABLED_KEY_PREFIX = "ipollowalk.extension.disabled.";
const EXTENSION_ENABLED_KEY_PREFIX = "ipollowalk.extension.enabled.";
const EXTENSION_HIDDEN_KEY_PREFIX = "ipollowalk.extension.hidden.";
export const IPOLLOWALK_EXTENSION_STATE_CHANGED = "ipollowalk:extension-state-changed";

export function getExtensionId(entry: McpDirectoryInfo): string {
  return entry.id ?? entry.serverName ?? getMcpServerName(entry);
}

export function isiPolloWalkExtensionEnabled(entry: McpDirectoryInfo): boolean {
  if (typeof window === "undefined") return Boolean(entry.defaultEnabled);
  const id = getExtensionId(entry);
  if (!entry.defaultEnabled) return window.localStorage.getItem(`${EXTENSION_ENABLED_KEY_PREFIX}${id}`) === "1";
  return window.localStorage.getItem(`${EXTENSION_DISABLED_KEY_PREFIX}${id}`) !== "1";
}

export function setiPolloWalkExtensionEnabled(entry: McpDirectoryInfo, enabled: boolean) {
  if (typeof window === "undefined") return;
  const id = getExtensionId(entry);
  if (entry.defaultEnabled) {
    const disabledKey = `${EXTENSION_DISABLED_KEY_PREFIX}${id}`;
    if (enabled) {
      window.localStorage.removeItem(disabledKey);
    } else {
      window.localStorage.setItem(disabledKey, "1");
    }
  } else {
    const enabledKey = `${EXTENSION_ENABLED_KEY_PREFIX}${id}`;
    if (enabled) {
      window.localStorage.setItem(enabledKey, "1");
    } else {
      window.localStorage.removeItem(enabledKey);
    }
  }
  window.dispatchEvent(new CustomEvent(IPOLLOWALK_EXTENSION_STATE_CHANGED, {
    detail: { id, enabled },
  }));
}

export function isiPolloWalkExtensionHidden(entryOrId: McpDirectoryInfo | string): boolean {
  const id = typeof entryOrId === "string" ? entryOrId : getExtensionId(entryOrId);
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(`${EXTENSION_HIDDEN_KEY_PREFIX}${id}`);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return typeof entryOrId !== "string" && entryOrId.defaultHidden === true;
}

export function setiPolloWalkExtensionHidden(entryOrId: McpDirectoryInfo | string, hidden: boolean) {
  const id = typeof entryOrId === "string" ? entryOrId : getExtensionId(entryOrId);
  if (typeof window === "undefined") return;
  const key = `${EXTENSION_HIDDEN_KEY_PREFIX}${id}`;
  window.localStorage.setItem(key, hidden ? "1" : "0");
  window.dispatchEvent(new CustomEvent(IPOLLOWALK_EXTENSION_STATE_CHANGED, {
    detail: { id, hidden },
  }));
}
