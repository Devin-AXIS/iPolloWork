import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const market = readFileSync(resolve(root, "src/react-app/domains/session/templates/template-market-dialog.tsx"), "utf8");

describe("template market cover loading", () => {
  test("loads card covers near the viewport and keeps previews eager", () => {
    expect(market).toContain('const TEMPLATE_COVER_ROOT_MARGIN = "480px 0px"');
    expect(market).toContain("new IntersectionObserver");
    expect(market).toContain("if (!shouldLoad) return;");
    expect(market).toContain("data-template-cover-lazy");
    expect(market).toContain("observer.disconnect()");
    expect(market).toContain("eager />");
  });
});
