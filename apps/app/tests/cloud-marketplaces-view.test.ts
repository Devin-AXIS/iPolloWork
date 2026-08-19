import { describe, expect, test } from "bun:test";

import {
  MARKETPLACE_CATEGORY_IDS,
  resolveMarketplaceCategory,
  shouldShowMarketplaceRows,
} from "../src/react-app/domains/settings/pages/cloud-marketplaces-view";

describe("Cloud marketplace row visibility", () => {
  test("requires a Cloud account but not an organization", () => {
    expect(shouldShowMarketplaceRows(false)).toBe(false);
    expect(shouldShowMarketplaceRows(true)).toBe(true);
  });

  test("installs Cloud artifacts only through the V2 package lifecycle", async () => {
    const source = await Bun.file(new URL("../src/react-app/domains/settings/pages/cloud-marketplaces-view.tsx", import.meta.url)).text();
    expect(source).toContain('listEnterpriseResources("extension")');
    expect(source).toContain("Promise.allSettled");
    expect(source).toContain('marketplaceResult.status === "rejected"');
    expect(source).toContain('localPackagesResult.status === "fulfilled"');
    expect(source).toContain("downloadEnterpriseResource(resource)");
    expect(source).toContain('readPluginPackageArchive(file, "install")');
    expect(source).toContain("validatePluginPackageUpload(workspaceId, upload)");
    expect(source).toContain("importPluginPackage(workspaceId, upload)");
    expect(source).toContain("<PluginPackageListItem");
    expect(source).toContain("<PluginPackageDetail");
    expect(source).toContain("onOpenInstalled");
    expect(source).not.toContain("activeOrganization");
    expect(source).not.toContain("DenOrgPlugin");
    expect(source).not.toContain("orgMcpConnections");
  });

  test("shares one detail page across marketplace and personal plugins", async () => {
    const marketplaceSource = await Bun.file(new URL("../src/react-app/domains/settings/pages/cloud-marketplaces-view.tsx", import.meta.url)).text();
    const personalSource = await Bun.file(new URL("../src/react-app/domains/settings/plugin-packages-panel.tsx", import.meta.url)).text();
    expect(marketplaceSource).toContain("<PluginPackageDetail");
    expect(personalSource).toContain("<PluginPackageDetail");
    expect(personalSource).toContain('t("plugin_platform.enable")');
    expect(personalSource).toContain('t("plugin_platform.status.needs_authorization")');
  });

  test("uses the canonical plugin library categories", () => {
    expect(MARKETPLACE_CATEGORY_IDS).toEqual([
      "ai-agents",
      "development-operations",
      "design-creative",
      "productivity-collaboration",
      "business-operations",
      "finance",
      "other",
    ]);
    expect(resolveMarketplaceCategory({ pluginId: "deepseek-harness", category: "Developer Tools", manifest: {} })).toBe("ai-agents");
    expect(resolveMarketplaceCategory({ pluginId: "figma", category: "Design & Development", manifest: {} })).toBe("design-creative");
    expect(resolveMarketplaceCategory({ pluginId: "linear", category: "Projects & Engineering", manifest: {} })).toBe("productivity-collaboration");
    expect(resolveMarketplaceCategory({ pluginId: "stripe", category: "Payments & Finance", manifest: {} })).toBe("finance");
    expect(resolveMarketplaceCategory({ pluginId: "unknown", category: "Uncategorized", manifest: {} })).toBe("other");
  });

  test("keeps raw MCP management out of the primary plugin page", async () => {
    const extensionsSource = await Bun.file(new URL("../src/react-app/domains/settings/pages/extensions-view.tsx", import.meta.url)).text();
    const routeSource = await Bun.file(new URL("../src/react-app/shell/settings-route.tsx", import.meta.url)).text();
    expect(extensionsSource).toContain("pluginPackagesView");
    expect(extensionsSource).toContain("skillsView");
    expect(extensionsSource).not.toContain("mcpView");
    expect(routeSource).not.toContain("<McpView");
  });
});
