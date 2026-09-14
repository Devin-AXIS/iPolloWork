import type { TemplateBrief } from "../templates/template-brief";
import type { ReferenceIngestionResult } from "./types";
import { selectReferenceChunks } from "./compression";

function cleanLine(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(value: string, limit: number): string {
  return cleanLine(value).slice(0, limit).trim();
}

function fileNameStem(name: string): string {
  return name.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ?? name;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleFromText(text: string, fileName: string): string {
  const h1 = text.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  if (h1?.[1]) return snippet(h1[1], 120);
  const first = text.split(/\r?\n/).map(cleanLine).find((line) => line.length > 1 && line.length <= 90 && !/[:：]|^Slide \d+$/.test(line));
  return first || fileNameStem(fileName);
}

function labelValue(text: string, labels: string[]): string {
  for (const line of text.split(/\r?\n/)) {
    const clean = cleanLine(line);
    for (const label of labels) {
      const match = clean.match(new RegExp(`^${escapeRegExp(label)}\\s*[:：]\\s*(.+)$`, "i"));
      if (match?.[1]) return snippet(match[1], 360);
    }
  }
  return "";
}

function fieldValue(item: ReferenceIngestionResult, labels: string[]): string {
  if (item.structuredData && typeof item.structuredData === "object" && !Array.isArray(item.structuredData)) {
    for (const [key, value] of Object.entries(item.structuredData)) {
      if (typeof value === "string" && labels.some((label) => label.toLowerCase() === key.toLowerCase())) {
        return snippet(value, 360);
      }
    }
  }
  return labelValue(item.extractedText, labels);
}

export function inferTemplateBriefFromIngestions(ingestions: ReferenceIngestionResult[]): TemplateBrief {
  const accepted = ingestions.filter((item) => item.quality === "high" || item.quality === "medium");
  const first = accepted[0];
  if (!first) return { title: "", audience: "", details: "" };

  const title = fieldValue(first, ["Title", "Topic", "标题", "主题", "视频主题"])
    || first.metadata?.headings?.[0]
    || (/\.(?:csv|json)$/i.test(first.fileName) ? fileNameStem(first.fileName) : titleFromText(first.extractedText, first.fileName));
  const audience = [...new Set(accepted.map((item) => fieldValue(item, ["Audience", "For", "Users", "Customers", "受众", "目标用户", "面向谁"])).filter(Boolean))].join("；");
  const details = accepted.map((item) => {
    const labeled = fieldValue(item, ["Requirements", "Details", "Key information", "Content", "Scope", "需求", "要求", "关键信息", "内容", "范围"]);
    if (labeled) return accepted.length === 1 ? labeled : `[${item.fileName}] ${labeled}`;
    return selectReferenceChunks(item.chunks, { maxChunks: Math.max(1, Math.floor(8 / accepted.length)), maxChunkChars: 500 })
      .map((chunk) => `[${item.fileName}${chunk.page ? ` · 第 ${chunk.page} 页` : chunk.heading ? ` · ${chunk.heading}` : ""}] ${cleanLine(chunk.text)}`).join("\n");
  }).filter(Boolean).join("\n").slice(0, 4000).trim();

  return { title, audience, details };
}
