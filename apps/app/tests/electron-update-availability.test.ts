import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isMissingReleaseError } from "../src/react-app/domains/settings/state/electron-updater-state";

const updaterStateSource = readFileSync(
  path.resolve(import.meta.dir, "../src/react-app/domains/settings/state/electron-updater-state.ts"),
  "utf8",
);

test("desktop updates stay visible when the cloud policy service is unavailable", () => {
  expect(updaterStateSource).not.toContain("isUpdateAllowed(");
  expect(updaterStateSource).toContain("const nextStatus: Exclude<SettingsUpdateStatus, null> = result.available");
});

test("only release-related 404 errors become a non-blocking missing-release state", () => {
  expect(isMissingReleaseError("HttpError: 404 latest.yml not found")).toBe(true);
  expect(isMissingReleaseError("Cannot find latest release: status code 404")).toBe(true);
  expect(isMissingReleaseError("Request failed with status code 503")).toBe(false);
  expect(isMissingReleaseError("Workspace request failed with HTTP 404")).toBe(false);
});
