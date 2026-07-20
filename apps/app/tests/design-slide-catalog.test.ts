import { describe, expect, test } from "bun:test";

const xhsDeckUrl = new URL("../../server/bundled-templates/ipollowork.html-anything.deck-xhs-post/entry.html", import.meta.url);
const dynamicDeckUrl = new URL("../../server/bundled-templates/ipollowork.html-anything.deck-ljg-present/entry.html", import.meta.url);

describe("Design slide catalog", () => {
  test("keeps the Xiaohongshu visual language inside a landscape presentation canvas", async () => {
    const html = await Bun.file(xhsDeckUrl).text();

    expect(html).toContain("width:1600px;height:900px");
    expect(html).toContain("width:1600px;height:900px;aspect-ratio:16/9");
    expect(html).not.toContain("width:810px;height:1080px");
    expect(html).not.toContain("aspect-ratio:3/4");
  });

  test("marks dynamic slide materialization so a saved deck does not run it twice", async () => {
    const html = await Bun.file(dynamicDeckUrl).text();

    expect(html).toContain("<script data-ipw-materialize-once>");
  });
});
