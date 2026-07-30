import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const panelSelect = readFileSync(new URL("../src/react-app/domains/session/design/design-panel-select.tsx", import.meta.url), "utf8");
const select = readFileSync(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8");
const popover = readFileSync(new URL("../src/components/ui/popover.tsx", import.meta.url), "utf8");

test("Design property menus escape the expanded panel overflow and stacking context", () => {
  expect(panelSelect).toContain("createPortal");
  expect(panelSelect).toContain('className={cn("fixed z-[70]');
  expect(select).toContain('className="isolate z-[70]"');
  expect(popover).toContain('className="isolate z-[70] outline-none"');
});
