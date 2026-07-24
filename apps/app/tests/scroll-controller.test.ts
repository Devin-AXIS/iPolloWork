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
    expect(controllerSource).toContain('syncProgrammaticScrollTop(container, container.scrollHeight, "smooth")');
    expect(controllerSource).not.toContain('container.scrollTo({ top: clampedTop, behavior: "auto" })');
  });

  test("synchronizes every transcript scroll event before it updates scroll state", () => {
    expect(controllerSource).toContain("syncCurrentScrollPosition(container)");
    expect(controllerSource).toContain("const syncCurrentScrollPosition = useCallback");
  });

  test("does not interrupt an anchor-driven smooth scroll with a second immediate scroll", () => {
    const programmaticReturn = controllerSource.indexOf("if (programmaticScrollRef.current)");
    const manualSync = controllerSource.indexOf("syncCurrentScrollPosition(container)", programmaticReturn);

    expect(programmaticReturn).toBeGreaterThan(-1);
    expect(manualSync).toBeGreaterThan(programmaticReturn);
  });
});
