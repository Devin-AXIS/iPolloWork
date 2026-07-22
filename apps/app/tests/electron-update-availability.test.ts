import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const updaterStateSource = readFileSync(
  path.resolve(import.meta.dir, "../src/react-app/domains/settings/state/electron-updater-state.ts"),
  "utf8",
);

test("desktop updates stay visible when the cloud policy service is unavailable", () => {
  expect(updaterStateSource).not.toContain("isUpdateAllowed(");
  expect(updaterStateSource).toContain("const nextStatus: Exclude<SettingsUpdateStatus, null> = result.available");
});
