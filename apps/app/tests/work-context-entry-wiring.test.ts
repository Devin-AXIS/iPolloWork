import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = readFileSync(resolve(import.meta.dir, "../src/react-app/shell/app-root.tsx"), "utf8");
const sidebar = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/sidebar/app-sidebar.tsx"),
  "utf8",
);
const enterpriseDialog = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/sidebar/enterprise-server-dialog.tsx"),
  "utf8",
);

describe("personal and Enterprise chat entry wiring", () => {
  test("routes a completed account sign-in directly to chat", () => {
    expect(appRoot).toContain('navigate("/session", { replace: true })');
    expect(appRoot).not.toContain('path="/onboarding"');
    expect(appRoot).not.toContain("WorkContextEntryPage");
    expect(appRoot).not.toContain("denSessionUpdatedEvent");
  });

  test("keeps Enterprise connection as an optional action inside chat", () => {
    expect(sidebar).toContain("<EnterpriseServerDialog");
    expect(sidebar).toContain("setEnterpriseDialogOpen(true)");
    expect(enterpriseDialog).toContain("discoverEnterpriseConnection(serverUrl)");
    expect(enterpriseDialog).toContain("saveEnterpriseConnection(connection)");
    expect(enterpriseDialog).toContain("props.onOpenChange(false)");
  });
});
