import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import {
  findSlashCommand,
  replaceLinePrefix,
  replaceSlashCommand,
  wrapMarkdownSelection,
  wrapMarkdownSelectionByLine,
} from "../src/react-app/domains/session/artifacts/markdown-editor-commands";
import {
  findMarkdownCodeBlocks,
  findMarkdownImages,
  findMarkdownTables,
  formatMarkdownImage,
} from "../src/react-app/domains/session/artifacts/markdown-rich-content";

describe("markdown editor commands", () => {
  test("finds a slash command at the cursor and preserves preceding text", () => {
    expect(findSlashCommand("Intro\n/h2", 9)).toEqual({ from: 6, to: 9, query: "h2" });
    expect(findSlashCommand("Use /path/to/file", 17)).toBeNull();
  });

  test("turns the current markdown line into another block type", () => {
    expect(replaceLinePrefix("## Existing heading", 12, "- [ ] ")).toEqual({
      from: 0,
      to: 3,
      insert: "- [ ] ",
      selection: { anchor: 15 },
    });
  });

  test("wraps selected text and selects a placeholder for an empty selection", () => {
    expect(wrapMarkdownSelection("hello", 0, 5, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 5,
      insert: "**hello**",
      selection: { anchor: 9 },
    });
    expect(wrapMarkdownSelection("", 0, 0, "`", "`", "code").selection).toEqual({ anchor: 1, head: 5 });
  });

  test("wraps multiline selections line by line for live preview formatting", () => {
    expect(wrapMarkdownSelectionByLine("one\ntwo\nthree", 0, 13, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 13,
      insert: "**one**\n**two**\n**three**",
      selection: { anchor: 25 },
    });
  });

  test("keeps a selected line break outside inline formatting", () => {
    expect(wrapMarkdownSelectionByLine("one\ntwo", 0, 4, "**", "**", "Bold text")).toEqual({
      from: 0,
      to: 4,
      insert: "**one**\n",
      selection: { anchor: 7 },
    });
  });

  test("keeps surrounding whitespace outside formatting markers", () => {
    const mixedText = "  English + 中文!  \n\t(v2.0) #ready\t";
    expect(wrapMarkdownSelectionByLine(mixedText, 0, mixedText.length, "**", "**", "Bold text").insert).toBe(
      "  **English + 中文!**  \n\t**(v2.0) #ready**\t",
    );
    expect(wrapMarkdownSelectionByLine(" [v2.0] #ready! ", 0, 16, "**", "**", "Bold text").insert).toBe(
      " **[v2.0] #ready!** ",
    );
  });

  test("produces valid bold markdown around mixed text and special characters", () => {
    for (const content of ["English + 中文!", "[v2.0] #ready!", "C:\\temp\\a.ts", "user@example.com", "(test)", "_value_"]) {
      const edit = wrapMarkdownSelectionByLine(content, 0, content.length, "**", "**", "Bold text");
      const state = EditorState.create({ doc: edit.insert, extensions: [markdown()] });
      let hasStrongEmphasis = false;
      syntaxTree(state).iterate({ enter: (node) => { if (node.name === "StrongEmphasis") hasStrongEmphasis = true; } });
      expect(hasStrongEmphasis).toBe(true);
    }
  });

  test("replaces the slash query with the chosen markdown block", () => {
    expect(replaceSlashCommand({ from: 4, to: 7, query: "h1" }, "# ")).toEqual({
      from: 4,
      to: 7,
      insert: "# ",
      selection: { anchor: 6 },
    });
  });
});

describe("markdown rich content", () => {
  test("finds standalone images and formats replacements safely", () => {
    expect(findMarkdownImages("Intro\n![Product preview](https://example.com/demo.png)\nOutro")).toEqual([
      { from: 6, to: 54, alt: "Product preview", url: "https://example.com/demo.png" },
    ]);
    const replacement = formatMarkdownImage("New ] preview", " https://example.com/new.png ");
    expect(replacement).toBe("![New \\] preview](https://example.com/new.png)");
    expect(findMarkdownImages(replacement)[0]?.alt).toBe("New ] preview");
  });

  test("keeps local image data URLs intact for live preview widgets", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lFTkSuQmCC";
    const markdown = formatMarkdownImage("捕获", dataUrl);
    expect(findMarkdownImages(markdown)).toEqual([{ from: 0, to: markdown.length, alt: "捕获", url: dataUrl }]);
  });

  test("wraps image paths with spaces so live preview parses the full target", () => {
    const localPath = "C:\\Users\\31939\\Pictures\\deep sea cover.png";
    const markdown = formatMarkdownImage("深海世界的奥秘", localPath);
    expect(markdown).toBe("![深海世界的奥秘](<C:\\Users\\31939\\Pictures\\deep sea cover.png>)");
    expect(findMarkdownImages(markdown)).toEqual([{ from: 0, to: markdown.length, alt: "深海世界的奥秘", url: localPath }]);
  });

  test("parses a GFM table into headers and rows", () => {
    const document = "| Name | Status |\n| --- | :---: |\n| Editor | Ready |\n| Save | Testing |\n";
    expect(findMarkdownTables(document)).toEqual([
      {
        from: 0,
        to: 71,
        headers: ["Name", "Status"],
        rows: [["Editor", "Ready"], ["Save", "Testing"]],
      },
    ]);
  });

  test("parses fenced code blocks with their language", () => {
    expect(findMarkdownCodeBlocks("Intro\n```ts\nconst ready = true;\n```\nOutro")).toEqual([
      { from: 6, to: 35, language: "ts", code: "const ready = true;" },
    ]);
  });
});
