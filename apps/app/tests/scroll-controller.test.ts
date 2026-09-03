import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controllerSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/surface/scroll-controller.ts"),
  "utf8",
);

describe("session scroll controller", () => {
  test("uses a transient anchor to synchronize immediate transcript positioning", () => {
    expect(controllerSource).toContain('container.ownerDocument.createElement("span")');
    expect(controllerSource).toContain('behavior: ScrollBehavior = "auto"');
    expect(controllerSource).toContain('anchor.scrollIntoView({ block: "start", inline: "nearest", behavior })');
    expect(controllerSource).toContain("anchor.remove()");
    expect(controllerSource).toContain("syncProgrammaticScrollTop(container, container.scrollHeight, behavior)");
    expect(controllerSource).toContain("const SMOOTH_SCROLL_RESET_MS = 700");
    expect(controllerSource).toContain('const resetDelay = behavior === "smooth" ? SMOOTH_SCROLL_RESET_MS : 50');
    expect(controllerSource).not.toContain('container.scrollTo({ top: clampedTop, behavior: "auto" })');
  });

  test("does not replay the scroll position while a user gesture is active", () => {
    const gestureBranch = controllerSource.indexOf("if (userGestured)");
    const gestureBranchEnd = controllerSource.indexOf("syncCurrentScrollPosition(container)", gestureBranch);
    const gestureSource = controllerSource.slice(gestureBranch, gestureBranchEnd);

    expect(gestureBranch).toBeGreaterThan(-1);
    expect(gestureBranchEnd).toBeGreaterThan(gestureBranch);
    expect(gestureSource).toContain("saveScrollPosition(container)");
    expect(gestureSource).toContain("lastKnownScrollTopRef.current = currentTop");
    expect(gestureSource).toContain("return");
  });

  test("does not interrupt an anchor-driven smooth scroll with a second immediate scroll", () => {
    const programmaticReturn = controllerSource.indexOf("if (programmaticScrollRef.current)");
    const manualSync = controllerSource.indexOf("syncCurrentScrollPosition(container)", programmaticReturn);

    expect(programmaticReturn).toBeGreaterThan(-1);
    expect(manualSync).toBeGreaterThan(programmaticReturn);
  });

  test("does not mistake an upward programmatic jump for a manual scroll", () => {
    const start = controllerSource.indexOf("if (programmaticScrollRef.current && userGestured)");
    const end = controllerSource.indexOf("if (programmaticScrollRef.current)", start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(controllerSource.slice(start, end)).not.toContain("scrolledUp");
    expect(controllerSource.match(/lastGestureAtRef\.current = 0;/g)).toHaveLength(2);
  });
});
