import { describe, expect, test } from "bun:test";

import type { DesignSelection } from "../src/react-app/domains/session/design/design-html-runtime";
import { summarizeDesignSelection } from "../src/react-app/domains/session/design/design-selection-summary";

function selection(id: string, styles: Partial<DesignSelection["styles"]> = {}): DesignSelection {
  return {
    id, tag: "p", locator: `body > p:nth-of-type(${id})`, html: `<p>${id}</p>`, text: id, href: "", src: "", source: "", alt: "",
    canEditText: true, canDelete: true, locked: false, colorField: "color", rangeText: "",
    rect: { top: 10, left: 20, width: 40, height: 30 },
    styles: {
      color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)", fontSize: "16px", fontFamily: "Arial",
      fontWeight: "400", fontStyle: "normal", textDecoration: "none", lineHeight: "normal", letterSpacing: "normal",
      textAlign: "left", transform: "none", borderRadius: "0px", padding: "0px", margin: "0px", position: "static",
      left: "auto", top: "auto", width: "40px", height: "30px", opacity: "1", borderWidth: "0px",
      borderStyle: "none", borderColor: "rgb(0, 0, 0)", boxShadow: "none", ...styles,
    },
  };
}

describe("Design selection summary", () => {
  test("reports a single primary selection without mixed style fields", () => {
    const primary = selection("1");
    const summary = summarizeDesignSelection(primary, [primary], primary.rect);
    expect(summary.isMultiSelection).toBe(false);
    expect(summary.selectionCount).toBe(1);
    expect(summary.mixedStyleFields).toEqual([]);
  });

  test("normalizes legacy single-selection updates without batch metadata", () => {
    const primary = selection("legacy");
    const summary = summarizeDesignSelection(primary);
    expect(summary.selections).toEqual([primary]);
    expect(summary.selectionIds).toEqual(["legacy"]);
    expect(summary.selectionRect).toEqual(primary.rect);
    expect(summary.isMultiSelection).toBe(false);
  });

  test("discards empty members from partially populated runtime updates", () => {
    const primary = selection("primary");
    const summary = summarizeDesignSelection(primary, [undefined, { id: "missing-styles" }, primary, null]);
    expect(summary.selections).toEqual([primary]);
    expect(summary.selectionIds).toEqual(["primary"]);
    expect(summary.mixedStyleFields).toEqual([]);
  });

  test("does not throw when the primary member has incomplete runtime styles", () => {
    const malformedPrimary = { ...selection("primary"), styles: undefined };
    // @ts-expect-error Runtime messages can be malformed before validation.
    expect(() => summarizeDesignSelection(malformedPrimary, [malformedPrimary])).not.toThrow();
  });

  test("retains runtime ordering and marks only divergent batch style fields as mixed", () => {
    const first = selection("1", { color: "rgb(0, 0, 0)", fontSize: "16px", width: "40px" });
    const primary = selection("2", { color: "rgb(255, 0, 0)", fontSize: "16px", width: "120px" });
    const summary = summarizeDesignSelection(primary, [first, primary], { top: 10, left: 20, width: 140, height: 30 });
    expect(summary.selectionIds).toEqual(["1", "2"]);
    expect(summary.primary.id).toBe("2");
    expect(summary.isMultiSelection).toBe(true);
    expect(summary.selectionRect).toEqual({ top: 10, left: 20, width: 140, height: 30 });
    expect(summary.mixedStyleFields).toEqual(["color"]);
    expect(summary.mixedStyleFields).not.toContain("width");
  });
});
