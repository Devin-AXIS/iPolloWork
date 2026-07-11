import { describe, expect, test } from "bun:test";

const templateUrl = new URL("../src/react-app/domains/session/design/templates/open-design/pitch-deck.html", import.meta.url);

describe("Design slide template", () => {
  test("ships a self-contained editable 16:9 deck", async () => {
    const html = await Bun.file(templateUrl).text();
    expect(html).toContain("aspect-ratio: 16 / 9");
    expect(html).toContain('data-ipw-template-kind="slides"');
    expect(html).toContain("--ipw-color-primary:");
    expect(html.match(/<section class="slide/g)?.length).toBe(7);
    expect(html.match(/class="notes"/g)?.length).toBe(7);
  });

  test("includes keyboard navigation and presentation chrome", async () => {
    const html = await Bun.file(templateUrl).text();
    expect(html).toContain("ArrowRight");
    expect(html).toContain("ArrowLeft");
    expect(html).toContain('data-action="prev"');
    expect(html).toContain('data-action="next"');
    expect(html).toContain('class="counter"');
  });
});
