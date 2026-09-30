import type { DouyinPublicationCopy } from "./douyin-publication";
import type { VideoDeliveryIntent } from "./video-project";
import type { WechatChannelsPublicationCopy } from "./wechat-channels-publication";
import { useSessionActivityStore } from "../status/session-activity-store";

export type HostVideoDeliverySignal = {
  workspaceId: string;
  sessionId: string;
  sourcePath: string;
  baselineFingerprint: string | null;
  operationKey: string;
  intent: VideoDeliveryIntent;
  promptText: string;
  publicationCopy?: DouyinPublicationCopy | WechatChannelsPublicationCopy;
};

const HOST_VIDEO_DELIVERY_EVENT = "ipollowork:host-video-delivery";
const HOST_VIDEO_DELIVERY_SETTLED_EVENT = "ipollowork:host-video-delivery-settled";
const HOST_VIDEO_DELIVERY_STORAGE_KEY = "ipollowork:host-video-deliveries:v1";
const HOST_VIDEO_DELIVERY_ERRORS_KEY = "ipollowork:host-video-delivery-errors:v1";
const HOST_VIDEO_DELIVERY_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
let deliveryStorageWritable = true;

function storedHostVideoDeliveries(): HostVideoDeliverySignal[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(HOST_VIDEO_DELIVERY_STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.slice(-50).flatMap((entry): HostVideoDeliverySignal[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Partial<HostVideoDeliverySignal> & { storedAt?: unknown };
      if (typeof record.workspaceId !== "string" || typeof record.sessionId !== "string"
        || typeof record.sourcePath !== "string" || typeof record.operationKey !== "string"
        || typeof record.promptText !== "string" || typeof record.storedAt !== "number"
        || Date.now() - record.storedAt > HOST_VIDEO_DELIVERY_MAX_AGE_MS
        || !["export", "publish-douyin", "publish-wechat-channels"].includes(record.intent ?? "")) return [];
      return [{
        workspaceId: record.workspaceId, sessionId: record.sessionId,
        sourcePath: record.sourcePath, operationKey: record.operationKey,
        promptText: record.promptText, intent: record.intent!,
        baselineFingerprint: typeof record.baselineFingerprint === "string" ? record.baselineFingerprint : null,
        ...(record.publicationCopy ? { publicationCopy: record.publicationCopy } : {}),
      }];
    });
  } catch {
    return [];
  }
}

const hostVideoDeliveries = new Map<string, HostVideoDeliverySignal>(
  storedHostVideoDeliveries().map((signal) => [`${signal.workspaceId}:${signal.sessionId}`, signal]),
);

function persistHostVideoDeliveries(signals: HostVideoDeliverySignal[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOST_VIDEO_DELIVERY_STORAGE_KEY, JSON.stringify(
      signals.slice(-50).map((signal) => ({ ...signal, storedAt: Date.now() })),
    ));
    deliveryStorageWritable = true;
  } catch {
    // Storage may be unavailable; the live delivery still remains in memory.
    deliveryStorageWritable = false;
  }
}

function deliveryKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}:${sessionId}`;
}

function storedHostVideoDeliveryErrors(): Array<{ workspaceId: string; sessionId: string; message: string; storedAt: number }> {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(HOST_VIDEO_DELIVERY_ERRORS_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.slice(-50).filter((item): item is { workspaceId: string; sessionId: string; message: string; storedAt: number } => (
      item && typeof item === "object"
      && typeof item.workspaceId === "string" && typeof item.sessionId === "string"
      && typeof item.message === "string" && typeof item.storedAt === "number"
      && Date.now() - item.storedAt <= HOST_VIDEO_DELIVERY_MAX_AGE_MS
    ));
  } catch {
    return [];
  }
}

export function readHostVideoDeliveryError(workspaceId: string, sessionId: string): string | null {
  return storedHostVideoDeliveryErrors().find((item) =>
    item.workspaceId === workspaceId && item.sessionId === sessionId)?.message ?? null;
}

function persistHostVideoDeliveryError(workspaceId: string, sessionId: string, message?: string) {
  if (typeof window === "undefined") return;
  try {
    const remaining = storedHostVideoDeliveryErrors().filter((item) =>
      item.workspaceId !== workspaceId || item.sessionId !== sessionId);
    if (message) remaining.push({ workspaceId, sessionId, message, storedAt: Date.now() });
    window.localStorage.setItem(HOST_VIDEO_DELIVERY_ERRORS_KEY, JSON.stringify(remaining.slice(-50)));
  } catch {
    // The in-memory activity status still carries the failure in this window.
  }
}

function reconcileHostVideoDeliveryActivity(onSettled?: (result: {
  workspaceId: string; sessionId: string; status: "done"; error: null;
}) => void) {
  if (typeof window === "undefined" || !deliveryStorageWritable) return;
  try {
    window.localStorage.getItem(HOST_VIDEO_DELIVERY_STORAGE_KEY);
  } catch {
    return;
  }
  const stored = new Map(storedHostVideoDeliveries().map((signal) => [deliveryKey(signal.workspaceId, signal.sessionId), signal]));
  const activity = useSessionActivityStore.getState();
  const settled = new Map([...hostVideoDeliveries]
    .filter(([key]) => !stored.has(key))
    .map(([key, signal]) => [key, { workspaceId: signal.workspaceId, sessionId: signal.sessionId }]));
  for (const [workspaceId, sessions] of Object.entries(activity.recordsByWorkspaceId)) {
    for (const [sessionId, record] of Object.entries(sessions)) {
      const key = deliveryKey(workspaceId, sessionId);
      if (record.hostDeliveryActive && !stored.has(key)) settled.set(key, { workspaceId, sessionId });
    }
  }
  for (const { workspaceId, sessionId } of settled.values()) {
    activity.setHostDelivery(workspaceId, sessionId, false);
    onSettled?.({ workspaceId, sessionId, status: "done", error: null });
  }
  hostVideoDeliveries.clear();
  for (const [key, signal] of stored) {
    hostVideoDeliveries.set(key, signal);
    if (!activity.recordsByWorkspaceId[signal.workspaceId]?.[signal.sessionId]?.hostDeliveryActive) {
      activity.setHostDelivery(signal.workspaceId, signal.sessionId, true);
    }
  }
}

reconcileHostVideoDeliveryActivity();

export function publishHostVideoDelivery(signal: HostVideoDeliverySignal) {
  const key = deliveryKey(signal.workspaceId, signal.sessionId);
  persistHostVideoDeliveryError(signal.workspaceId, signal.sessionId);
  hostVideoDeliveries.set(key, signal);
  const stored = new Map(storedHostVideoDeliveries().map((entry) => [deliveryKey(entry.workspaceId, entry.sessionId), entry]));
  stored.set(key, signal);
  persistHostVideoDeliveries([...stored.values()]);
  useSessionActivityStore.getState().setHostDelivery(signal.workspaceId, signal.sessionId, true);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<HostVideoDeliverySignal>(HOST_VIDEO_DELIVERY_EVENT, { detail: signal }));
  }
}

export function currentHostVideoDelivery(workspaceId: string, sessionId: string) {
  const key = deliveryKey(workspaceId, sessionId);
  const stored = storedHostVideoDeliveries().find((signal) => deliveryKey(signal.workspaceId, signal.sessionId) === key);
  if (stored) {
    hostVideoDeliveries.set(key, stored);
    return stored;
  }
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem(HOST_VIDEO_DELIVERY_STORAGE_KEY) !== null) {
      hostVideoDeliveries.delete(key);
      return null;
    }
  } catch {
    // Fall back to the live in-memory delivery when storage is unavailable.
  }
  return hostVideoDeliveries.get(key) ?? null;
}

export function clearHostVideoDelivery(workspaceId: string, sessionId: string, operationKey?: string, error?: string) {
  const key = deliveryKey(workspaceId, sessionId);
  const current = currentHostVideoDelivery(workspaceId, sessionId);
  if (!current || (operationKey && current.operationKey !== operationKey)) return;
  hostVideoDeliveries.delete(key);
  persistHostVideoDeliveries(storedHostVideoDeliveries().filter((signal) => deliveryKey(signal.workspaceId, signal.sessionId) !== key));
  persistHostVideoDeliveryError(workspaceId, sessionId, error);
  useSessionActivityStore.getState().setHostDelivery(workspaceId, sessionId, false, error);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HOST_VIDEO_DELIVERY_SETTLED_EVENT, {
      detail: { workspaceId, sessionId, status: error ? "failed" : "done", error: error ?? null },
    }));
  }
}

export function subscribeHostVideoDeliverySettled(listener: (result: {
  workspaceId: string; sessionId: string; status: "done" | "failed"; error: string | null;
}) => void) {
  if (typeof window === "undefined") return () => undefined;
  reconcileHostVideoDeliveryActivity(listener);
  const handle = (event: Event) => listener((event as CustomEvent<{
    workspaceId: string; sessionId: string; status: "done" | "failed"; error: string | null;
  }>).detail);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === HOST_VIDEO_DELIVERY_STORAGE_KEY) reconcileHostVideoDeliveryActivity(listener);
  };
  window.addEventListener(HOST_VIDEO_DELIVERY_SETTLED_EVENT, handle);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(HOST_VIDEO_DELIVERY_SETTLED_EVENT, handle);
    window.removeEventListener("storage", handleStorage);
  };
}

export function subscribeHostVideoDelivery(listener: (signal: HostVideoDeliverySignal) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handle = (event: Event) => listener((event as CustomEvent<HostVideoDeliverySignal>).detail);
  window.addEventListener(HOST_VIDEO_DELIVERY_EVENT, handle);
  return () => window.removeEventListener(HOST_VIDEO_DELIVERY_EVENT, handle);
}
