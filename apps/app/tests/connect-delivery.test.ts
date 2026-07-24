import { describe, expect, test } from "bun:test";

import {
  resolveMarketplaceDeliveryAction,
  shouldShowExtensionsMarketplacePane,
} from "../src/react-app/domains/settings/connect-delivery";

describe("Connect delivery switch decisions", () => {
  test("keeps the Extensions marketplace pane in both rollout modes", () => {
    expect(shouldShowExtensionsMarketplacePane()).toBe(true);
    expect(shouldShowExtensionsMarketplacePane(false)).toBe(true);
    expect(shouldShowExtensionsMarketplacePane(true)).toBe(true);
  });

  test("keeps desktop import actions outside Connect mode", () => {
    expect(resolveMarketplaceDeliveryAction({ importedLocally: false })).toBe("install");
    expect(resolveMarketplaceDeliveryAction({ connectEnabled: false, importedLocally: true })).toBe("install");
  });

  test("moves marketplace cards to cloud-active states in Connect mode", () => {
    expect(resolveMarketplaceDeliveryAction({ connectEnabled: true, importedLocally: false })).toBe("cloud_active");
    expect(resolveMarketplaceDeliveryAction({ connectEnabled: true, importedLocally: true })).toBe("cloud_active_local_copy");
  });
});
