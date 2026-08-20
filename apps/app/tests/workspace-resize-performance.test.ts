import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync(
  new URL("../src/react-app/shell/workspace-shell-layout.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const sessionPageSource = readFileSync(
  new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const uiStateSource = readFileSync(
  new URL("../src/react-app/shell/ui-state-store.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

function functionBody(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("workspace resize performance", () => {
  test("updates the left sidebar DOM per frame and commits store state on release", () => {
    const dragBody = functionBody(
      layoutSource,
      "const handleMove = (moveEvent: PointerEvent) => {",
      "useEffect(() => {",
    );
    const moveBody = functionBody(
      dragBody,
      "const handleMove = (moveEvent: PointerEvent) => {",
      "const handleStop = () => {",
    );

    expect(moveBody).toContain("window.requestAnimationFrame(applyPendingWidth)");
    expect(moveBody).not.toContain("setLeftSidebarWidth(");
    expect(dragBody).toContain("setLeftSidebarWidth(nextWidth);");
    expect(dragBody).toContain("setPointerCapture(event.pointerId)");
  });

  test("updates the right panel DOM per frame and persists width once on release", () => {
    const dragBody = functionBody(
      sessionPageSource,
      "const startRightPanelResize = useCallback",
      "const handleDesignAskAi = useCallback",
    );
    const moveBody = functionBody(
      dragBody,
      "const handleMove = (moveEvent: PointerEvent) => {",
      "const handleStop = () => {",
    );

    expect(moveBody).toContain("window.requestAnimationFrame(applyPendingWidth)");
    expect(moveBody).not.toContain("setBrowserPanelWidth(");
    expect(dragBody).toContain("setBrowserPanelWidth(nextWidth);");
    expect(dragBody).toContain("setRightPanelManuallyResized(true);");
    expect(dragBody).toContain("resizeHandle.setPointerCapture(event.pointerId);");
    expect(sessionPageSource).toContain("ref={rightPanelElementRef}");
    expect(sessionPageSource).toMatch(
      /const preferredVideoPanelWidth = rightPanelManuallyResized\s+\? browserPanelDefaultWidth/,
    );
  });

  test("does not persist transient resize start and stop flags", () => {
    expect(uiStateSource).toContain(
      "state.workspaceLeftSidebarWidth === previous.workspaceLeftSidebarWidth",
    );
    expect(uiStateSource).not.toContain(
      "state.workspaceLeftSidebarResizing === previous.workspaceLeftSidebarResizing",
    );
  });

  test("lets embedded settings shrink to the main workspace width", () => {
    expect(sessionPageSource).toContain(
      '<div className="relative flex min-h-0 min-w-0 flex-1">',
    );
  });

  test("hides the right-panel toggle from the embedded Extensions navigation", () => {
    expect(sessionPageSource).toContain(
      '{mainHeaderHidden && mainWorkspaceView !== "extensions" ? (',
    );
  });

  test("keeps the starter navigation shell while hiding its title", () => {
    expect(sessionPageSource).toContain("mac:titlebar-drag");
    expect(sessionPageSource).toContain(
      'const mainHeaderHidden = mainWorkspaceView === "extensions";',
    );
    expect(sessionPageSource).toContain("{showMainHeaderTitle ? (");
  });
});
