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

  test("keeps the Xiaohongshu deck scrollable when opened without runtime", async () => {
    const html = await Bun.file(xhsDeckUrl).text();

    expect(html).toContain(".tpl-xhs-post .deck{width:100vw;height:auto;min-height:100vh;overflow:visible}");
    expect(html).toContain(".tpl-xhs-post .slide{position:relative;inset:auto;width:100vw;height:100vh;opacity:1;pointer-events:auto;transform:none;page-break-after:always}");
    expect(html).not.toContain("ipw-page-controls");
  });

  test("marks dynamic slide materialization so a saved deck does not run it twice", async () => {
    const html = await Bun.file(dynamicDeckUrl).text();

    expect(html).toContain("<script data-ipw-materialize-once>");
  });
});
