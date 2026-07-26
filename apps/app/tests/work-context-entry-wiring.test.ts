import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = readFileSync(resolve(import.meta.dir, "../src/react-app/shell/app-root.tsx"), "utf8");
const entryPage = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/onboarding/work-context-entry-page.tsx"),
  "utf8",
);

describe("personal and Enterprise entry wiring", () => {
  test("routes a completed account sign-in to the work context entry", () => {
    expect(appRoot).toContain('path="/onboarding"');
    expect(appRoot).toContain('navigate("/onboarding", { replace: true })');
    expect(appRoot).toContain("<WorkContextEntryPage />");
    expect(appRoot).not.toContain("denSessionUpdatedEvent");
    expect(entryPage).toContain("markRouteReady()");
  });

  test("does not restore the retired Cloud organization picker", () => {
    expect(appRoot).not.toContain("OrgOnboardingPage");
    expect(entryPage).not.toContain("listOrgs");
    expect(entryPage).not.toContain("activeOrg");
    expect(entryPage).not.toContain("createDenClient");
  });
});
