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

function resolveInlineDelimiters(content: string, before: string, after: string) {
  if (before !== after) {
    return { before, after };
  }

  if ((before === "**" || before === "*") && (content.startsWith("*") || content.endsWith("*"))) {
    const delimiter = before.replaceAll("*", "_");
    return { before: delimiter, after: delimiter };
  }

  if (before === "`" && content.includes("`")) {
    return { before: "`` ", after: " ``" };
  }

  return { before, after };
}

function isStronglyMarked(content: string) {
  return (content.startsWith("**") && content.endsWith("**") && content.length >= 4)
    || (content.startsWith("__") && content.endsWith("__") && content.length >= 4);
}

function getLineContentWithoutPrefix(line: string) {
  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
  const contentWithPrefix = line.slice(leadingWhitespace.length, line.length - trailingWhitespace.length);
  const linePrefix = contentWithPrefix.match(LINE_PREFIX)?.[0] ?? "";
  return contentWithPrefix.slice(linePrefix.length);
}

function selectionIsInsideStrongMarks(document: string, from: number, to: number, before: string, after: string) {
  return before === "**"
    && after === "**"
    && (
      (document.slice(Math.max(0, from - 2), from) === "**" && document.slice(to, to + 2) === "**")
      || (document.slice(Math.max(0, from - 2), from) === "__" && document.slice(to, to + 2) === "__")
    );
}

function selectionLineIsStronglyMarked(document: string, position: number, before: string, after: string) {
  if (before !== "**" || after !== "**") return false;

  const lineStart = document.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const lineEndIndex = document.indexOf("\n", position);
  const lineEnd = lineEndIndex === -1 ? document.length : lineEndIndex;
  return isStronglyMarked(getLineContentWithoutPrefix(document.slice(lineStart, lineEnd)));
}

type StrongRange = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
};

function getStrongRangesForLine(document: string, position: number, before: string, after: string) {
  if (before !== "**" || after !== "**") return null;

  const { lineStart, lineEnd } = getLineBounds(document, position);
  const line = document.slice(lineStart, lineEnd);
  const strongMark = /(\*\*|__)(?=\S)(.*?\S)\1/g;
  const ranges: StrongRange[] = [];
  let match: RegExpExecArray | null;

  while ((match = strongMark.exec(line)) !== null) {
    const rangeFrom = lineStart + match.index;
    const rangeTo = rangeFrom + match[0].length;
    ranges.push({
      from: rangeFrom,
      to: rangeTo,
      contentFrom: rangeFrom + match[1].length,
      contentTo: rangeTo - match[1].length,
    });
  }

  return ranges;
}

function expandSelectionAroundStrongMarks(document: string, from: number, to: number, before: string, after: string) {
  if (before !== "**" || after !== "**") return { from, to };

  let expandedFrom = from;
  let expandedTo = to;
  let position = from;

  while (position <= expandedTo) {
    const { lineEnd } = getLineBounds(document, position);
    const ranges = getStrongRangesForLine(document, position, before, after) ?? [];

    for (const range of ranges) {
      if (expandedFrom <= range.to && expandedTo >= range.from) {
        expandedFrom = Math.min(expandedFrom, range.from);
        expandedTo = Math.max(expandedTo, range.to);
      }
    }

    if (lineEnd >= document.length) break;
    position = lineEnd + 1;
  }

  return { from: expandedFrom, to: expandedTo };
}

function getLineBounds(document: string, position: number) {
  const lineStart = document.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const lineEndIndex = document.indexOf("\n", position);
  const lineEnd = lineEndIndex === -1 ? document.length : lineEndIndex;
  return { lineStart, lineEnd };
}

function getLinePrefixBounds(document: string, position: number) {
  const { lineStart, lineEnd } = getLineBounds(document, position);
  const line = document.slice(lineStart, lineEnd);
  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const contentWithPrefix = line.slice(leadingWhitespace.length);
  const linePrefix = contentWithPrefix.match(LINE_PREFIX)?.[0] ?? "";
  const prefixFrom = lineStart + leadingWhitespace.length;
  const prefixTo = prefixFrom + linePrefix.length;
  return { prefixFrom, prefixTo };
}

function selectionIsOnlyLinePrefix(document: string, from: number, to: number) {
  const { lineEnd } = getLineBounds(document, from);
  if (to > lineEnd) return false;

  const { prefixFrom, prefixTo } = getLinePrefixBounds(document, from);
  if (prefixFrom === prefixTo) return false;
  return from >= prefixFrom && to <= prefixTo;
}

function getSelectionContentStart(document: string, line: string, lineFrom: number) {
  const { prefixTo } = getLinePrefixBounds(document, lineFrom);
  const markerEnd = Math.max(0, Math.min(line.length, prefixTo - lineFrom));
  const selectedLeadingWhitespace = line.slice(markerEnd).match(/^\s*/)?.[0].length ?? 0;
  return markerEnd + selectedLeadingWhitespace;
}

function rangeTouches(from: number, to: number, range: StrongRange) {
  return from < range.to && to > range.from;
}

function selectionContainsPlainContent(document: string, from: number, to: number, ranges: StrongRange[]) {
  for (let position = from; position < to; position += 1) {
    const character = document[position];
    if (!character || /\s/.test(character)) continue;

    const { prefixFrom, prefixTo } = getLinePrefixBounds(document, position);
    if (position >= prefixFrom && position < prefixTo) continue;

    const insideStrongRange = ranges.some((range) => position >= range.from && position < range.to);
    if (!insideStrongRange) return true;
  }

  return false;
}

function mergeTouchingStrongRanges(from: number, to: number, ranges: StrongRange[]) {
  let mergedFrom = from;
  let mergedTo = to;
  let changed = true;

  while (changed) {
    changed = false;
    for (const range of ranges) {
      if (!rangeTouches(mergedFrom, mergedTo, range)) continue;
      const nextFrom = Math.min(mergedFrom, range.from);
      const nextTo = Math.max(mergedTo, range.to);
      if (nextFrom !== mergedFrom || nextTo !== mergedTo) {
        mergedFrom = nextFrom;
        mergedTo = nextTo;
        changed = true;
      }
    }
  }

  return { from: mergedFrom, to: mergedTo };
}

function stripStrongMarkers(document: string, from: number, to: number, ranges: StrongRange[]) {
  const markerRanges = ranges
    .filter((range) => range.from >= from && range.to <= to)
    .flatMap((range) => [
      { from: range.from - from, to: range.contentFrom - from },
      { from: range.contentTo - from, to: range.to - from },
    ])
    .sort((left, right) => right.from - left.from);

  let content = document.slice(from, to);
  for (const marker of markerRanges) {
    content = content.slice(0, marker.from) + content.slice(marker.to);
  }

  return content;
}

export function wrapMarkdownSelectionByLine(
  document: string,
  from: number,
  to: number,
  before: string,
  after: string,
  placeholder: string,
): MarkdownEdit {
  const normalizedSelection = expandSelectionAroundStrongMarks(document, from, to, before, after);
  from = normalizedSelection.from;
  to = normalizedSelection.to;

  const selected = document.slice(from, to);

  if (!selected) {
    return wrapMarkdownSelection(document, from, to, before, after, placeholder);
  }

  if (selectionIsInsideStrongMarks(document, from, to, before, after)) {
    return { from, to, insert: selected, selection: { anchor: from, head: to } };
  }

  if (selectionIsOnlyLinePrefix(document, from, to)) {
    return { from, to, insert: selected, selection: { anchor: from, head: to } };
  }

  const wrapLine = (line: string, lineFrom: number) => {
    if (!line.trim()) return line;
    const contentStart = getSelectionContentStart(document, line, lineFrom);
    const leadingWhitespace = line.slice(0, contentStart);
    const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
    const content = line.slice(contentStart, line.length - trailingWhitespace.length);
    if (!content.trim()) return line;
    if (before === "**" && after === "**" && isStronglyMarked(content)) return line;
    if (selectionLineIsStronglyMarked(document, lineFrom, before, after)) return line;
    const delimiters = resolveInlineDelimiters(content, before, after);
    return `${leadingWhitespace}${delimiters.before}${content}${delimiters.after}${trailingWhitespace}`;
  };

  const buildSingleLineEdit = (line: string, lineFrom: number) => {
    if (before === "**" && after === "**") {
      const ranges = getStrongRangesForLine(document, lineFrom, before, after) ?? [];
      const touchingRanges = ranges.filter((range) => rangeTouches(lineFrom, lineFrom + line.length, range));

      if (touchingRanges.length) {
        const selectionHasPlainContent = selectionContainsPlainContent(document, lineFrom, lineFrom + line.length, touchingRanges);
        const merged = mergeTouchingStrongRanges(lineFrom, lineFrom + line.length, ranges);
        const insert = selectionHasPlainContent
          ? wrapLine(stripStrongMarkers(document, merged.from, merged.to, ranges), merged.from)
          : document.slice(merged.from, merged.to);

        return { from: merged.from, to: merged.to, insert };
      }
    }

    return { from: lineFrom, to: lineFrom + line.length, insert: wrapLine(line, lineFrom) };
  };

  if (!selected.includes("\n")) {
    const edit = buildSingleLineEdit(selected, from);
    return { ...edit, selection: { anchor: edit.from + edit.insert.length } };
  }

  const trailingNewlines = selected.match(/\n+$/)?.[0] ?? "";
  const body = trailingNewlines ? selected.slice(0, -trailingNewlines.length) : selected;

  if (!body) {
    return wrapMarkdownSelection(document, from, to, before, after, placeholder);
  }

  let lineFrom = from;
  const insert = body
    .split("\n")
    .map((line) => {
      const wrapped = buildSingleLineEdit(line, lineFrom).insert;
      lineFrom += line.length + 1;
      return wrapped;
    })
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
