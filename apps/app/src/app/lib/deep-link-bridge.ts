export const deepLinkBridgeEvent = "ipollowork:deep-link";
export const nativeDeepLinkEvent = "ipollowork:deep-link-native";

export type DeepLinkBridgeDetail = {
  urls: string[];
};

declare global {
  interface Window {
    __IPOLLOWORK__?: {
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

  target.__IPOLLOWORK__ ??= {};
  const pending = target.__IPOLLOWORK__.deepLinks ?? [];
  target.__IPOLLOWORK__.deepLinks = [...pending, ...normalized];
  target.dispatchEvent(
    new CustomEvent<DeepLinkBridgeDetail>(deepLinkBridgeEvent, {
      detail: { urls: normalized },
    }),
  );
  return normalized;
}

export function drainPendingDeepLinks(target: Window): string[] {
  const pending = target.__IPOLLOWORK__?.deepLinks ?? [];
  if (target.__IPOLLOWORK__) {
    target.__IPOLLOWORK__.deepLinks = [];
  }
  return [...pending];
}
