import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const panelSource = readFileSync(
  path.resolve(import.meta.dir, "../src/react-app/domains/session/design/design-panel.tsx"),
  "utf8",
);

test("standard Design previews fill the available right-panel height", () => {
  expect(panelSource).toContain('? "h-full w-full rounded-lg shadow-sm"');
  expect(panelSource).toContain('"h-full w-[390px] max-w-full shrink-0 rounded-[26px] shadow-xl shadow-black/15"');
  expect(panelSource).toContain('"absolute left-1/2 top-1/2 h-[900px] w-[1600px] origin-center rounded-lg shadow-sm"');
});
