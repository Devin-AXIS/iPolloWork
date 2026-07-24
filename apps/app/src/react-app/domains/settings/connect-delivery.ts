export type MarketplaceDeliveryActionKind = "install" | "cloud_active" | "cloud_active_local_copy";

export function shouldShowExtensionsMarketplacePane(_connectEnabled?: boolean) {
  return true;
}

export function resolveMarketplaceDeliveryAction(input: {
  connectEnabled?: boolean;
  importedLocally: boolean;
}): MarketplaceDeliveryActionKind {
  if (input.connectEnabled !== true) return "install";
  return input.importedLocally ? "cloud_active_local_copy" : "cloud_active";
}
