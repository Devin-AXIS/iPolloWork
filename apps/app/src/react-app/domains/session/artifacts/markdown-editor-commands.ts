export type MarkdownEdit = {
  from: number;
  to: number;
  insert: string;
  selection: { anchor: number; head?: number };
};

export type SlashCommandMatch = {
  from: number;
  to: number;
  query: string;
};

const LINE_PREFIX = /^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+)/;

export function findSlashCommand(document: string, cursor: number): SlashCommandMatch | null {
  const lineStart = document.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const beforeCursor = document.slice(lineStart, cursor);
  const match = beforeCursor.match(/(?:^|\s)\/([a-z0-9-]*)$/i);

  if (!match || match.index === undefined) return null;

  const leadingSpace = match[0].startsWith(" ") ? 1 : 0;
  const from = lineStart + match.index + leadingSpace;
  return { from, to: cursor, query: match[1].toLowerCase() };
}

export function replaceLinePrefix(document: string, cursor: number, prefix: string): MarkdownEdit {
  const lineStart = document.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const lineEndIndex = document.indexOf("\n", cursor);
  const lineEnd = lineEndIndex === -1 ? document.length : lineEndIndex;
  const line = document.slice(lineStart, lineEnd);
  const existing = line.match(LINE_PREFIX)?.[0] ?? "";
  const delta = prefix.length - existing.length;

  return {
    from: lineStart,
    to: lineStart + existing.length,
    insert: prefix,
    selection: { anchor: Math.max(lineStart + prefix.length, cursor + delta) },
  };
}

export function wrapMarkdownSelection(
  document: string,
  from: number,
  to: number,
  before: string,
  after: string,
  placeholder: string,
): MarkdownEdit {
  const selected = document.slice(from, to);
  const content = selected || placeholder;
  const insert = `${before}${content}${after}`;

  return {
    from,
    to,
    insert,
    selection: selected
      ? { anchor: from + insert.length }
      : { anchor: from + before.length, head: from + before.length + content.length },
  };
}

export function wrapMarkdownSelectionByLine(
  document: string,
  from: number,
  to: number,
  before: string,
  after: string,
  placeholder: string,
): MarkdownEdit {
  const selected = document.slice(from, to);

  if (!selected) {
    return wrapMarkdownSelection(document, from, to, before, after, placeholder);
  }

  const wrapLine = (line: string) => {
    if (!line.trim()) return line;
    const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
    const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
    const content = line.slice(leadingWhitespace.length, line.length - trailingWhitespace.length);
    return `${leadingWhitespace}${before}${content}${after}${trailingWhitespace}`;
  };

  if (!selected.includes("\n")) {
    const insert = wrapLine(selected);
    return { from, to, insert, selection: { anchor: from + insert.length } };
  }

  const trailingNewlines = selected.match(/\n+$/)?.[0] ?? "";
  const body = trailingNewlines ? selected.slice(0, -trailingNewlines.length) : selected;

  if (!body) {
    return wrapMarkdownSelection(document, from, to, before, after, placeholder);
  }

  const insert = body
    .split("\n")
    .map(wrapLine)
    .join("\n") + trailingNewlines;

  return {
    from,
    to,
    insert,
    selection: { anchor: from + insert.length - trailingNewlines.length },
  };
}

export function replaceSlashCommand(match: SlashCommandMatch, insert: string, cursorOffset = insert.length): MarkdownEdit {
  return {
    from: match.from,
    to: match.to,
    insert,
    selection: { anchor: match.from + cursorOffset },
  };
}
