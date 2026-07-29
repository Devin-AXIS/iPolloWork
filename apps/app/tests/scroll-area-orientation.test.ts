import { describe, expect, test } from "bun:test";

const scrollAreaUrl = new URL("../src/components/ui/scroll-area.tsx", import.meta.url);
const globalCssUrl = new URL("../src/app/index.css", import.meta.url);

describe("scroll area orientation", () => {
  test("does not apply a horizontal minimum width to vertical thumbs", async () => {
    const source = await Bun.file(scrollAreaUrl).text();

    expect(source).toContain('orientation === "vertical" ? "w-full min-h-14" : "h-full min-w-14"');
    expect(source).not.toContain('className="relative min-h-14 min-w-14');
  });

  test("keeps native scrollbar minimum sizes scoped by orientation", async () => {
    const css = await Bun.file(globalCssUrl).text();

    expect(css).toContain("*::-webkit-scrollbar-thumb:vertical");
    expect(css).toContain("*::-webkit-scrollbar-thumb:horizontal");
  });
});
