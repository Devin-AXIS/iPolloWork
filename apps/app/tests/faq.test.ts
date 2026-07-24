import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseFaqDocument, searchFaqItems } from "../src/app/lib/faq";

const faqPath = resolve(import.meta.dir, "../../../packages/docs/faq/question-bank.zh-CN.mdx");

describe("FAQ knowledge base", () => {
  test("parses the full Chinese question bank", async () => {
    const source = await readFile(faqPath, "utf8");
    const document = parseFaqDocument(source);

    expect(document.items).toHaveLength(100);
    expect(document.categories).toEqual([
      "产品定位",
      "安装与系统",
      "Work",
      "Code",
      "Create",
      "Video",
      "模型、MCP 与 Skills",
      "开发者与技术栈",
      "Cloud 与团队",
      "安全、授权与支持",
    ]);
    expect(new Set(document.items.map((item) => item.id)).size).toBe(100);
    expect(new Set(document.items.map((item) => item.question)).size).toBe(100);
    expect(document.items[0]?.id).toBe("faq-001");
    expect(document.items.at(-1)?.id).toBe("faq-100");
    for (const category of document.categories) {
      expect(document.items.filter((item) => item.category === category)).toHaveLength(10);
    }
    for (const item of document.items) {
      expect(item.answer.length).toBeGreaterThan(0);
      expect(item.scope.length).toBeGreaterThan(0);
      expect(item.sources.length).toBeGreaterThan(0);
    }
    expect(document.items.find((item) => item.id === "faq-053")?.answer)
      .toContain("`video/{session-id}/index.html`");
    expect(source).not.toContain("WWork");
  });

  test("searches Chinese text and former product aliases", async () => {
    const source = await readFile(faqPath, "utf8");
    const items = parseFaqDocument(source).items;

    expect(searchFaqItems(items, "连接模型", null).length).toBeGreaterThan(0);
    expect(searchFaqItems(items, "WWork", null)).toHaveLength(10);
    expect(searchFaqItems(items, "WWork", null).every((item) => item.category === "Work")).toBeTrue();
    expect(searchFaqItems(items, "Design", null)).toHaveLength(10);
    expect(searchFaqItems(items, "Design", null).every((item) => item.category === "Create")).toBeTrue();
    expect(searchFaqItems(items, "视频", "Code")).toEqual([]);
  });
});
