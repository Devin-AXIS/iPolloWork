import { describe, expect, test } from "bun:test";

import {
  findSlashCommand,
  replaceLinePrefix,
  replaceSlashCommand,
  wrapMarkdownSelection,
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
