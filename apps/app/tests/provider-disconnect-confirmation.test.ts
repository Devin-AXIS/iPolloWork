import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const aiView = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/settings/pages/ai-view.tsx"),
  "utf8",
);
const settingsRoute = readFileSync(
  join(import.meta.dir, "../src/react-app/shell/settings-route.tsx"),
  "utf8",
);

describe("provider disconnect confirmation", () => {
  test("asks for confirmation before disconnecting a provider", () => {
    expect(aiView).toContain("setDisconnectTarget(provider)");
    expect(aiView).toContain("<ConfirmModal");
    expect(aiView).toContain('title={t("providers.disconnect_confirm_title"');
    expect(aiView).toContain('variant="danger"');
  });

  test("shows immediate progress and reports the background result", () => {
    expect(aiView).toContain("setLocalDisconnectingProviderId(target.id)");
    expect(aiView).toContain('t("settings.disconnecting")');
    expect(aiView).toContain("toast.success");
    expect(aiView).toContain("toast.error");
    expect(settingsRoute).toContain("providerAuthStore.disconnectProvider(providerId)");
    expect(settingsRoute).toContain("await refreshUserEnvKeys()");
  });
});
