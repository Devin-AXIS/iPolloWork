import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const providerAuthStore = readFileSync(
  join(import.meta.dir, "../src/react-app/domains/connections/provider-auth/store.ts"),
  "utf8",
);

describe("synthetic provider disconnect", () => {
  test("removes runtime-owned Qwen and TokenStar providers before refreshing", () => {
    expect(providerAuthStore).toContain("const runtimeOwnedProviderId");
    expect(providerAuthStore).toContain("resolvedLower === QWEN3_CODER_PROVIDER.providerId");
    expect(providerAuthStore).toContain("resolvedLower === TOKENSTAR_PROVIDER.providerId");
    expect(providerAuthStore).toContain("await patchRuntimeProviders({ [runtimeOwnedProviderId]: null })");
    expect(providerAuthStore).toContain("formatConfigWithoutCloudProvider(\n              raw,\n              runtimeOwnedProviderId,");
  });
});
