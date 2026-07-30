import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const designPanel = readFileSync(new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url), "utf8");
const exportMenu = readFileSync(new URL("../src/react-app/domains/session/design/design-export-menu.tsx", import.meta.url), "utf8");
const sidePanel = readFileSync(new URL("../src/react-app/domains/session/panel/side-panel.tsx", import.meta.url), "utf8");
const dropdownMenu = readFileSync(new URL("../src/components/ui/dropdown-menu.tsx", import.meta.url), "utf8");

test("expanded Design menus render above the z-60 panel", () => {
  expect(sidePanel).toContain('positionerClassName={expanded ? "z-[70]" : undefined}');
  expect(exportMenu).toContain('positionerClassName={expanded ? "z-[70]" : undefined}');
  expect(dropdownMenu).toContain("positionerClassName");
  expect(sidePanel).toContain("expanded={expanded}");
});

test("the parent presentation viewport handles Ctrl or Meta wheel zoom", () => {
  expect(designPanel).toContain("!event.ctrlKey && !event.metaKey");
  expect(designPanel).toContain("presentationCanvasWheelZoom(current, event.deltaY)");
  expect(designPanel).toContain('addEventListener("wheel"');
  expect(designPanel).toContain("passive: false");
});
