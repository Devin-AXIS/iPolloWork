import { describe, expect, test } from "bun:test";

import { isTemplateDesignEntryTarget } from "../src/react-app/domains/session/design/design-entry-target";

describe("template Design entry routing", () => {
  test("routes a generated template entry back to the editable Design canvas", () => {
    expect(isTemplateDesignEntryTarget(
      { kind: "file", value: "design/ses_presentation/entry.html" },
      "design/ses_presentation/entry.html",
    )).toBe(true);
  });

  test("does not intercept unrelated files or external links", () => {
    expect(isTemplateDesignEntryTarget(
      { kind: "file", value: "design/ses_presentation/brief.json" },
      "design/ses_presentation/entry.html",
    )).toBe(false);
    expect(isTemplateDesignEntryTarget(
      { kind: "url", value: "https://example.com" },
      "design/ses_presentation/entry.html",
    )).toBe(false);
  });
});
