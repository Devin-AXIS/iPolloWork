import type { DouyinPublicationCopy } from "./douyin-publication";
import type { VideoDeliveryIntent } from "./video-project";
import type { WechatChannelsPublicationCopy } from "./wechat-channels-publication";

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
const hostVideoDeliveries = new Map<string, HostVideoDeliverySignal>();

function deliveryKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}:${sessionId}`;
}

export function publishHostVideoDelivery(signal: HostVideoDeliverySignal) {
  hostVideoDeliveries.set(deliveryKey(signal.workspaceId, signal.sessionId), signal);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<HostVideoDeliverySignal>(HOST_VIDEO_DELIVERY_EVENT, { detail: signal }));
  }
}

export function currentHostVideoDelivery(workspaceId: string, sessionId: string) {
  return hostVideoDeliveries.get(deliveryKey(workspaceId, sessionId)) ?? null;
}

export function clearHostVideoDelivery(workspaceId: string, sessionId: string, operationKey?: string) {
  const key = deliveryKey(workspaceId, sessionId);
  const current = hostVideoDeliveries.get(key);
  if (!current || (operationKey && current.operationKey !== operationKey)) return;
  hostVideoDeliveries.delete(key);
}

export function subscribeHostVideoDelivery(listener: (signal: HostVideoDeliverySignal) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handle = (event: Event) => listener((event as CustomEvent<HostVideoDeliverySignal>).detail);
  window.addEventListener(HOST_VIDEO_DELIVERY_EVENT, handle);
  return () => window.removeEventListener(HOST_VIDEO_DELIVERY_EVENT, handle);
}
