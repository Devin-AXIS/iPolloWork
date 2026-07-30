import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const marketDialog = readFileSync(
  new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
  "utf8",
);

describe("template market actions", () => {
  test("keeps package import but hides save-current controls", () => {
    expect(marketDialog).toContain('t("template_market.import_ipwt")');
    expect(marketDialog).not.toContain('t("template_market.save_current")');
    expect(marketDialog).not.toContain("onSaveCurrent");
    expect(marketDialog).not.toContain("canSaveCurrent");
  });
});
