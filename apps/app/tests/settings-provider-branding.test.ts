import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { formatProviderAuthName } from "../src/react-app/domains/connections/provider-auth/provider-auth-curation";

const settingsRouteSource = readFileSync(
  new URL("../src/react-app/shell/settings-route.tsx", import.meta.url),
  "utf8",
);
const aiViewSource = readFileSync(
  new URL("../src/react-app/domains/settings/pages/ai-view.tsx", import.meta.url),
  "utf8",
);
const providerIconSource = readFileSync(
  new URL("../src/react-app/design-system/provider-icon.tsx", import.meta.url),
  "utf8",
);
const providerAuthModalSource = readFileSync(
  new URL("../src/react-app/domains/connections/provider-auth/provider-auth-modal.tsx", import.meta.url),
  "utf8",
);
const startupDialogSource = readFileSync(
  new URL("../src/react-app/domains/cloud/ipollowork-models-startup-dialog.tsx", import.meta.url),
  "utf8",
);
const zhSource = readFileSync(new URL("../src/i18n/locales/zh.ts", import.meta.url), "utf8");
const enSource = readFileSync(new URL("../src/i18n/locales/en.ts", import.meta.url), "utf8");

describe("settings provider branding", () => {
  test("white-labels the bundled provider name", () => {
    expect(formatProviderAuthName("opencode")).toBe("iPolloWork Built-in Models");
    expect(formatProviderAuthName("opencode", "OpenCode Zen")).toBe("iPolloWork Built-in Models");
  });

  test("white-labels connected provider display names and ids in the AI settings page", () => {
    expect(settingsRouteSource).toContain("formatProviderAuthName(providerId, provider?.name)");
    expect(settingsRouteSource).toContain('displayId: providerId.trim().toLowerCase() === "opencode" ? "ipollowork" : providerId');
    expect(aiViewSource).toContain("{provider.displayId ?? provider.id}");
    expect(aiViewSource).toContain("providerName={provider.name}");
    expect(aiViewSource).toContain('provider.id !== "opencode"');
  });

  test("derives connected providers from the current account as well as the active engine", () => {
    expect(settingsRouteSource).toContain(
      "const effectiveProviderConnectedIds = providerAuthSnapshot.connectedProviderIds",
    );
    expect(settingsRouteSource).toContain("connectedProviderIds={effectiveProviderConnectedIds}");
  });

  test("does not show OpenCode copy in AI provider user-facing strings", () => {
    expect(zhSource).not.toContain("OpenCode Zen");
    expect(zhSource).not.toContain("API\u5bc6\u94a5\u7531OpenCode");
    expect(enSource).not.toContain("OpenCode Zen");
    expect(enSource).not.toContain("API keys are stored locally by OpenCode");
    expect(providerAuthModalSource).not.toContain("OpenCode Zen");
    expect(startupDialogSource).not.toContain("OpenCode Zen");
  });

  test("uses the current bundled iPolloWork logo asset for built-in provider icons", () => {
    expect(providerIconSource).toContain('publicAssetUrl("default-brand-avatar.jpg")');
    expect(providerIconSource).not.toContain('publicAssetUrl("ipollowork-logo.svg")');
    expect(providerIconSource).not.toContain('viewBox="0 0 476 500"');
  });

  test("keeps OpenAI OAuth on the original desktop browser opener", () => {
    expect(providerAuthModalSource).toContain("if (isDesktopRuntime()) {");
    expect(providerAuthModalSource).toContain("isiPolloWorkBuiltInProvider(providerId)");
    expect(providerAuthModalSource).toContain("await openDesktopAuthUrl(url)");
    expect(providerAuthModalSource).toContain("await openDesktopUrl(url)");
    expect(providerAuthModalSource).toContain("openOauthUrl = async (providerId: string, url: string)");
  });
});
