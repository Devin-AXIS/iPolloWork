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
    expect(controllerSource).toContain("return container.scrollTop");
    expect(controllerSource).toContain("syncProgrammaticScrollTop(container, container.scrollHeight, behavior)");
    expect(controllerSource).toContain('const resetDelay = behavior === "smooth" ? PROGRAMMATIC_SCROLL_SETTLE_MS : 50');
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

  test("only a new manual gesture interrupts a programmatic scroll", () => {
    expect(controllerSource).toContain("programmaticScrollGestureVersionRef.current = scrollGestureVersionRef.current");
    expect(controllerSource).toContain("scrollGestureVersionRef.current += 1");
    expect(controllerSource).toContain("userInterruptedProgrammaticScroll || scrolledAgainstProgrammaticDirection");
    expect(controllerSource).not.toContain("programmaticScrollRef.current && (userGestured || scrolledUp)");

    const interruptionBranch = controllerSource.indexOf("if (programmaticScrollRef.current && (userInterruptedProgrammaticScroll");
    const interruptionEnd = controllerSource.indexOf("if (programmaticScrollRef.current)", interruptionBranch + 1);
    expect(controllerSource.slice(interruptionBranch, interruptionEnd)).toContain("syncCurrentScrollPosition(container)");
  });
});
