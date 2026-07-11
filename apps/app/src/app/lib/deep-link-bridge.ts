export const deepLinkBridgeEvent = "ipollowalk:deep-link";
export const nativeDeepLinkEvent = "ipollowalk:deep-link-native";

export type DeepLinkBridgeDetail = {
  urls: string[];
};

declare global {
  interface Window {
    __IPOLLOWALK__?: {
      deepLinks?: string[];
    };
  }
}

function normalizeDeepLinks(urls: readonly string[]): string[] {
  return urls.flatMap((url) => {
    const trimmed = url.trim();
    return trimmed ? [trimmed] : [];
  });
}

export function pushPendingDeepLinks(target: Window, urls: readonly string[]): string[] {
  const normalized = normalizeDeepLinks(urls);
  if (normalized.length === 0) {
    return [];
  }

  target.__IPOLLOWALK__ ??= {};
  const pending = target.__IPOLLOWALK__.deepLinks ?? [];
  target.__IPOLLOWALK__.deepLinks = [...pending, ...normalized];
  target.dispatchEvent(
    new CustomEvent<DeepLinkBridgeDetail>(deepLinkBridgeEvent, {
      detail: { urls: normalized },
    }),
  );
  return normalized;
}

export function drainPendingDeepLinks(target: Window): string[] {
  const pending = target.__IPOLLOWALK__?.deepLinks ?? [];
  if (target.__IPOLLOWALK__) {
    target.__IPOLLOWALK__.deepLinks = [];
  }
  return [...pending];
}
