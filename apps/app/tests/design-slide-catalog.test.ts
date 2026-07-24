import { describe, expect, test } from "bun:test";

const dynamicDeckUrl = new URL("../../server/bundled-templates/ipollowork.html-anything.deck-ljg-present/entry.html", import.meta.url);

describe("Design slide catalog", () => {
  test("marks dynamic slide materialization so a saved deck does not run it twice", async () => {
    const html = await Bun.file(dynamicDeckUrl).text();

    expect(html).toContain("<script data-ipw-materialize-once>");
  });
});
