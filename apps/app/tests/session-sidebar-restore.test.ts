import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sessionPageSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/chat/session-page.tsx"),
  "utf8",
);
const useMobileSource = readFileSync(
  resolve(import.meta.dir, "../src/hooks/use-mobile.ts"),
  "utf8",
);
const sidebarSource = readFileSync(
  resolve(import.meta.dir, "../src/components/ui/sidebar.tsx"),
  "utf8",
);

function mainTitlebarLeadSource() {
  const headerStart = sessionPageSource.indexOf("<header");
  const titleStart = sessionPageSource.indexOf("<h1", headerStart);
  expect(headerStart).toBeGreaterThan(-1);
  expect(titleStart).toBeGreaterThan(headerStart);
  return sessionPageSource.slice(headerStart, titleStart);
}

describe("session sidebar restore control", () => {
  test("shows a main titlebar trigger when the sidebar is collapsed", () => {
    const titlebarLead = mainTitlebarLeadSource();

    expect(sessionPageSource).toContain("SidebarTrigger");
    expect(titlebarLead).toContain("!sidebarOpen ? (");
    expect(titlebarLead).toContain("<SidebarTrigger");
    expect(titlebarLead).toContain('aria-label={t("sidebar.expand")}');
  });

  test("keeps the desktop sidebar layout when an Electron window is narrow", () => {
    expect(useMobileSource).toContain("isNarrowMobileViewport");
    expect(useMobileSource).toContain("__IPOLLOWORK_ELECTRON__");
    expect(useMobileSource).toContain("return false");
    expect(sidebarSource).toContain("hidden md:block electron:block");
  });
});
