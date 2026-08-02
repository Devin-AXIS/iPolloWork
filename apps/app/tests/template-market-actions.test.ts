import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const marketDialog = readFileSync(
  new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
  "utf8",
);

describe("template market actions", () => {
  test("separates local package import from publishing a template", () => {
    expect(marketDialog).toContain('t("template_market.import_local")');
    expect(marketDialog).toContain('t("template_market.publish_enterprise")');
    expect(marketDialog).toContain('showPublish={source === "mine"}');
    expect(marketDialog).toContain("props.onPublish(publishTemplate)");
    expect(marketDialog).not.toContain('t("template_market.save_current")');
    expect(marketDialog).not.toContain("onSaveCurrent");
    expect(marketDialog).not.toContain("canSaveCurrent");
  });
});
