import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const chatMarkdown = readFileSync(new URL("../src/components/markdown/markdown.tsx", import.meta.url), "utf8");
const surfaceMarkdown = readFileSync(new URL("../src/react-app/domains/session/surface/markdown.tsx", import.meta.url), "utf8");

test("markdown tables scroll horizontally instead of clipping narrow columns", () => {
  for (const source of [chatMarkdown, surfaceMarkdown]) {
    expect(source).toContain('class="my-4 max-w-full overflow-x-auto"');
    expect(source).toContain('class="w-max min-w-full border-collapse"');
  }
});
