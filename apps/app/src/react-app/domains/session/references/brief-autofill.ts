import type { TemplateBrief } from "../templates/template-brief";
import type { ReferenceIngestionResult } from "./types";

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

function titleFromText(text: string, fileName: string): string {
  const h1 = text.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  if (h1?.[1]) return snippet(h1[1], 120);
  const first = text.split(/\r?\n/).map(cleanLine).find((line) => line.length > 1 && line.length <= 90 && !/:$/.test(line));
  return first || fileNameStem(fileName);
}

function labelValue(text: string, labels: string[]): string {
  for (const line of text.split(/\r?\n/)) {
    const clean = cleanLine(line);
    for (const label of labels) {
      const match = clean.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "i"));
      if (match?.[1]) return snippet(match[1], 360);
    }
  }
  return "";
}

export function inferTemplateBriefFromIngestions(ingestions: ReferenceIngestionResult[]): TemplateBrief {
  const accepted = ingestions.filter((item) => item.quality === "high" || item.quality === "medium");
  const first = accepted[0];
  if (!first) return { title: "", audience: "", details: "" };

  const combined = accepted
    .map((item) => [item.extractedText, ...item.chunks.slice(0, 4).map((chunk) => chunk.text)].join("\n"))
    .join("\n\n");
  const title = titleFromText(first.extractedText, first.fileName);
  const audience = labelValue(combined, ["Audience", "For", "Users", "Customers"]);
  const details = labelValue(combined, ["Requirements", "Details", "Key information", "Content", "Scope"])
    || accepted.flatMap((item) => item.chunks).slice(0, 3).map((chunk) => cleanLine(chunk.text)).join(" ").slice(0, 700).trim();

  return { title, audience, details };
}
