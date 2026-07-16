declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => { toBe: (expected: unknown) => void; toEqual: (expected: unknown) => void };

import { wrapMarkdownSelectionByLine } from "./markdown-editor-commands";

describe("markdown editor commands", () => {
  test("wraps a plain selection with bold markers", () => {
    expect(wrapMarkdownSelectionByLine("hello world", 0, 5, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 5,
      insert: "**hello**",
      selection: { anchor: 9 },
    });
  });

  test("wraps selected lines without pulling trailing newlines into bold text", () => {
    expect(wrapMarkdownSelectionByLine("one\ntwo\n", 0, 8, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 8,
      insert: "**one**\n**two**\n",
      selection: { anchor: 15 },
    });
  });

  test("keeps indentation and trailing spaces outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("  value  ", 0, 9, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 9,
      insert: "  **value**  ",
      selection: { anchor: 13 },
    });
  });

  test("uses underscore bold markers when selected text touches literal asterisks", () => {
    expect(wrapMarkdownSelectionByLine("*important*", 0, 11, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 11,
      insert: "__*important*__",
      selection: { anchor: 15 },
    });
  });

  test("keeps markdown list markers outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("- Important", 0, 11, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 11,
      insert: "- **Important**",
      selection: { anchor: 15 },
    });
  });

  test("keeps rendered list marker and following space outside bold markers when selecting a whole row", () => {
    expect(wrapMarkdownSelectionByLine("- Travel checklist", 0, 18, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 18,
      insert: "- **Travel checklist**",
      selection: { anchor: 22 },
    });
  });

  test("keeps selected leading spaces after a list marker outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("-  Travel checklist", 0, 19, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 19,
      insert: "-  **Travel checklist**",
      selection: { anchor: 23 },
    });
  });

  test("keeps a selected space after a list marker outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("- Travel checklist", 1, 18, "**", "**", "Bold text")).toEqual({
      from: 1,
      to: 18,
      insert: " **Travel checklist**",
      selection: { anchor: 22 },
    });
  });

  test("keeps selected trailing spaces outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("Travel checklist ", 0, 17, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 17,
      insert: "**Travel checklist** ",
      selection: { anchor: 21 },
    });
  });

  test("keeps selected leading and trailing spaces outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine(" Travel checklist ", 0, 18, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 18,
      insert: " **Travel checklist** ",
      selection: { anchor: 22 },
    });
  });

  test("keeps selected extra spaces before list content outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("-  Travel checklist", 2, 19, "**", "**", "Bold text")).toEqual({
      from: 2,
      to: 19,
      insert: " **Travel checklist**",
      selection: { anchor: 23 },
    });
  });

  test("keeps selected trailing spaces after list content outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("- Travel checklist ", 0, 19, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 19,
      insert: "- **Travel checklist** ",
      selection: { anchor: 23 },
    });
  });

  test("keeps spaces outside bold markers for common rendered markdown selections", () => {
    const samples = [
      "- Travel checklist ",
      "1. Travel checklist ",
      "- [ ] Travel checklist ",
      "## Travel checklist ",
      "> Travel checklist ",
      "  - Travel checklist ",
    ];

    for (const sample of samples) {
      for (let from = 0; from < sample.length; from += 1) {
        for (let to = from + 1; to <= sample.length; to += 1) {
          const selected = sample.slice(from, to);
          if (!selected.includes("Travel")) continue;

          const result = wrapMarkdownSelectionByLine(sample, from, to, "**", "**", "Bold text");
          expect(result.insert.includes("**  ")).toBe(false);
          expect(result.insert.includes("** " + selected.trimStart()[0])).toBe(false);
          expect(result.insert.includes(selected.trimEnd().at(-1) + " **")).toBe(false);
        }
      }
    }
  });

  test("does not wrap a selected bullet list marker", () => {
    expect(wrapMarkdownSelectionByLine("- Important", 0, 1, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 1,
      insert: "-",
      selection: { anchor: 0, head: 1 },
    });
  });

  test("does not wrap selected ordered list markers", () => {
    expect(wrapMarkdownSelectionByLine("1. Important", 0, 2, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 2,
      insert: "1.",
      selection: { anchor: 0, head: 2 },
    });
  });

  test("does not wrap selected task list markers", () => {
    expect(wrapMarkdownSelectionByLine("- [ ] Important", 0, 6, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 6,
      insert: "- [ ] ",
      selection: { anchor: 0, head: 6 },
    });
  });

  test("keeps ordered list marker outside bold markers when selecting a whole row", () => {
    expect(wrapMarkdownSelectionByLine("1. Important", 0, 12, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 12,
      insert: "1. **Important**",
      selection: { anchor: 16 },
    });
  });

  test("keeps task list marker outside bold markers when selecting a whole row", () => {
    expect(wrapMarkdownSelectionByLine("- [ ] Important", 0, 15, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 15,
      insert: "- [ ] **Important**",
      selection: { anchor: 19 },
    });
  });

  test("does not double-wrap an already bold markdown list row", () => {
    expect(wrapMarkdownSelectionByLine("- **Important**", 0, 15, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 15,
      insert: "- **Important**",
      selection: { anchor: 15 },
    });
  });

  test("wraps only unformatted content when selected markdown list rows span lines", () => {
    expect(wrapMarkdownSelectionByLine("- **Important**\n- Normal\n", 0, 25, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 25,
      insert: "- **Important**\n- **Normal**\n",
      selection: { anchor: 28 },
    });
  });

  test("keeps selected marker spaces outside bold markers across lines", () => {
    expect(wrapMarkdownSelectionByLine("- First\n- Second\n", 1, 16, "**", "**", "Bold text")).toEqual({
      from: 1,
      to: 16,
      insert: " **First**\n- **Second**",
      selection: { anchor: 24 },
    });
  });

  test("keeps heading markers outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("## Title", 0, 8, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 8,
      insert: "## **Title**",
      selection: { anchor: 12 },
    });
  });

  test("keeps quote markers outside bold markers", () => {
    expect(wrapMarkdownSelectionByLine("> Quote", 0, 7, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 7,
      insert: "> **Quote**",
      selection: { anchor: 11 },
    });
  });

  test("keeps heading marker and space outside bold markers when selecting a whole row", () => {
    expect(wrapMarkdownSelectionByLine("## Travel checklist", 0, 19, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 19,
      insert: "## **Travel checklist**",
      selection: { anchor: 23 },
    });
  });

  test("keeps quote marker and space outside bold markers when selecting a whole row", () => {
    expect(wrapMarkdownSelectionByLine("> Travel checklist", 0, 18, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 18,
      insert: "> **Travel checklist**",
      selection: { anchor: 22 },
    });
  });

  test("does not wrap selected heading markers", () => {
    expect(wrapMarkdownSelectionByLine("## Title", 0, 2, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 2,
      insert: "##",
      selection: { anchor: 0, head: 2 },
    });
  });

  test("does not wrap selected quote markers", () => {
    expect(wrapMarkdownSelectionByLine("> Quote", 0, 1, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 1,
      insert: ">",
      selection: { anchor: 0, head: 1 },
    });
  });

  test("does not add visible markers around text already inside hidden bold markers", () => {
    expect(wrapMarkdownSelectionByLine("- **Important**", 4, 13, "**", "**", "Bold text")).toEqual({
      from: 2,
      to: 15,
      insert: "**Important**",
      selection: { anchor: 15 },
    });
  });

  test("does not wrap visible text from an already bold rendered list row", () => {
    expect(wrapMarkdownSelectionByLine("- **Important**", 2, 13, "**", "**", "Bold text")).toEqual({
      from: 2,
      to: 15,
      insert: "**Important**",
      selection: { anchor: 15 },
    });
  });

  test("does not introduce markers for rendered selections inside already bold rows", () => {
    const sample = "- **Travel checklist** ";

    for (let from = 0; from < sample.length; from += 1) {
      for (let to = from + 1; to <= sample.length; to += 1) {
        const selected = sample.slice(from, to);
        if (!selected.includes("Travel")) continue;

        const result = wrapMarkdownSelectionByLine(sample, from, to, "**", "**", "Bold text");
        const suffix = to > sample.length - 1 ? " " : "";
        const prefix = from === 0 ? "- " : from === 1 ? " " : "";
        expect(result.insert).toBe(`${prefix}**Travel checklist**${suffix}`);
      }
    }
  });

  test("skips already bold rows but still wraps plain rows in the same selection", () => {
    expect(wrapMarkdownSelectionByLine("- **Travel checklist**\n- Normal item", 0, 36, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 36,
      insert: "- **Travel checklist**\n- **Normal item**",
      selection: { anchor: 40 },
    });
  });

  test("formats rendered Chinese list selections without exposing bold markers", () => {
    expect(wrapMarkdownSelectionByLine("- 常见摄影问题解答", 0, 11, "**", "**", "Bold text").insert).toBe("- **常见摄影问题解答**");
    expect(wrapMarkdownSelectionByLine("- 常见摄影问题解答", 1, 11, "**", "**", "Bold text").insert).toBe(" **常见摄影问题解答**");
    expect(wrapMarkdownSelectionByLine("- 常见摄影问题解答", 2, 11, "**", "**", "Bold text").insert).toBe("**常见摄影问题解答**");
  });

  test("does not add visible markers when a rendered Chinese list row is already bold", () => {
    const sample = "- **常见摄影问题解答**";

    expect(wrapMarkdownSelectionByLine(sample, 0, sample.length, "**", "**", "Bold text").insert).toBe(sample);
    expect(wrapMarkdownSelectionByLine(sample, 2, sample.length, "**", "**", "Bold text").insert).toBe("**常见摄影问题解答**");
    expect(wrapMarkdownSelectionByLine(sample, 4, sample.length - 2, "**", "**", "Bold text").insert).toBe("**常见摄影问题解答**");
  });

  test("keeps bold valid across mixed rendered markdown rows", () => {
    const sample = "- **摄影师推荐**\n- 摄影挑战清单\n- 照片管理指南";

    expect(wrapMarkdownSelectionByLine(sample, 0, sample.length, "**", "**", "Bold text").insert).toBe(
      "- **摄影师推荐**\n- **摄影挑战清单**\n- **照片管理指南**",
    );
  });

  test("uses double backticks when inline code contains a backtick", () => {
    expect(wrapMarkdownSelectionByLine("`value`", 0, 7, "`", "`", "code")).toEqual({
      from: 0,
      to: 7,
      insert: "`` `value` ``",
      selection: { anchor: 13 },
    });
  });
});
