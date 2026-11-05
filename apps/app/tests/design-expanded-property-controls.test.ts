import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const panelSelect = readFileSync(new URL("../src/react-app/domains/session/design/design-panel-select.tsx", import.meta.url), "utf8");
const select = readFileSync(new URL("../../../packages/ui/src/react/select.tsx", import.meta.url), "utf8");
const popover = readFileSync(new URL("../../../packages/ui/src/react/popover.tsx", import.meta.url), "utf8");

test("Design property menus escape the expanded panel overflow and stacking context", () => {
  expect(panelSelect).toContain('from "@/components/ui/select"');
  expect(panelSelect).toContain('<SelectContent align="start"');
  expect(select).toContain('<SelectPrimitive.Portal>');
  expect(select).toContain('> & { positionerClassName?: string })');
  expect(select).toContain('className={cn("isolate z-[90]", positionerClassName)}');
  expect(popover).toContain('className="isolate z-[90] outline-none"');
});
