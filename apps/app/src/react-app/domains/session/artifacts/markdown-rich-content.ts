export type MarkdownImage = {
  from: number;
  to: number;
  alt: string;
  url: string;
};

export type MarkdownTable = {
  from: number;
  to: number;
  headers: string[];
  rows: string[][];
};

export type MarkdownCodeBlock = {
  from: number;
  to: number;
  language: string;
  code: string;
};

const IMAGE_LINE = /^\s*!\[((?:\\.|[^\]])*)\]\((\S+?)(?:\s+["'][^"']*["'])?\)\s*$/;
const TABLE_DIVIDER_CELL = /^:?-{3,}:?$/;

function documentLines(document: string) {
  const lines: Array<{ from: number; to: number; text: string }> = [];
  let from = 0;

  for (const text of document.split("\n")) {
    lines.push({ from, to: from + text.length, text });
    from += text.length + 1;
  }

  return lines;
}

export function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!trimmed.includes("|")) return [];
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

export function findMarkdownImages(document: string): MarkdownImage[] {
  return documentLines(document).flatMap((line) => {
    const match = line.text.match(IMAGE_LINE);
    if (!match) return [];
    return [{ from: line.from, to: line.to, alt: match[1].replace(/\\\]/g, "]"), url: match[2] }];
  });
}

export function findMarkdownTables(document: string): MarkdownTable[] {
  const lines = documentLines(document);
  const tables: MarkdownTable[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = parseMarkdownTableRow(lines[index].text);
    const divider = parseMarkdownTableRow(lines[index + 1].text);
    if (!headers.length || divider.length !== headers.length || divider.some((cell) => !TABLE_DIVIDER_CELL.test(cell))) continue;

    const rows: string[][] = [];
    let lastIndex = index + 1;
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const cells = parseMarkdownTableRow(lines[rowIndex].text);
      if (!cells.length) break;
      rows.push(headers.map((_, cellIndex) => cells[cellIndex] ?? ""));
      lastIndex = rowIndex;
    }

    tables.push({ from: lines[index].from, to: lines[lastIndex].to, headers, rows });
    index = lastIndex;
  }

  return tables;
}

export function findMarkdownCodeBlocks(document: string): MarkdownCodeBlock[] {
  const lines = documentLines(document);
  const blocks: MarkdownCodeBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].text.match(/^\s*(`{3,}|~{3,})([^`]*)$/);
    if (!opening) continue;
    const marker = opening[1][0];
    const minimumLength = opening[1].length;

    for (let closeIndex = index + 1; closeIndex < lines.length; closeIndex += 1) {
      const closing = lines[closeIndex].text.trim();
      if (closing[0] !== marker || closing.length < minimumLength || [...closing].some((character) => character !== marker)) continue;
      blocks.push({
        from: lines[index].from,
        to: lines[closeIndex].to,
        language: opening[2].trim(),
        code: lines.slice(index + 1, closeIndex).map((line) => line.text).join("\n"),
      });
      index = closeIndex;
      break;
    }
  }

  return blocks;
}

export function formatMarkdownImage(alt: string, url: string) {
  return `![${alt.replace(/\]/g, "\\]")}](${url.trim()})`;
}
