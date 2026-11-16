// Structure-aware Markdown chunks reused by outbound channel renderers.
const DEFAULT_CHUNK_LIMIT = 4_500;
const CODE_FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

function safeSliceIndex(value, limit) {
  let index = Math.min(limit, value.length);
  const before = value.charCodeAt(index - 1);
  const after = value.charCodeAt(index);
  if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) {
    index -= 1;
  }
  return Math.max(1, index);
}

function openingFence(line) {
  const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
  const match = CODE_FENCE_OPEN.exec(normalized);
  if (!match) return null;
  // CommonMark forbids backticks in the info string of a backtick fence.
  if (match[2][0] === '`' && match[3].includes('`')) return null;
  return { delimiter: match[2], info: match[3], indent: match[1].length };
}

function closesFence(line, opening) {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return Boolean(match
    && match[1][0] === opening.delimiter[0]
    && match[1].length >= opening.delimiter.length);
}

function longestLeadingRun(text, character) {
  let longest = 0;
  for (const line of text.split('\n')) {
    let offset = 0;
    while (offset < 3 && line[offset] === ' ') offset += 1;
    let length = 0;
    while (line[offset + length] === character) length += 1;
    longest = Math.max(longest, length);
  }
  return longest;
}

function safeCodeFence(text, info) {
  const backticks = '`'.repeat(Math.max(3, longestLeadingRun(text, '`') + 1));
  const tildes = '~'.repeat(Math.max(3, longestLeadingRun(text, '~') + 1));
  if (info.includes('`')) return tildes;
  return backticks.length <= tildes.length ? backticks : tildes;
}

// Exposed for callers that fence arbitrary, untrusted text verbatim (e.g. the
// /tail export): pick a delimiter longer than any leading run in the body, so
// the body can never close its own fence.
export { longestLeadingRun, safeCodeFence };

function removeFenceIndent(line, indent) {
  let index = 0;
  let column = 0;
  let remaining = indent;
  while (remaining > 0 && index < line.length) {
    if (line[index] === ' ') {
      index += 1;
      column += 1;
      remaining -= 1;
      continue;
    }
    if (line[index] === '\t') {
      const width = 4 - (column % 4);
      if (width <= remaining) {
        index += 1;
        column += width;
        remaining -= width;
        continue;
      }
      return `${' '.repeat(width - remaining)}${line.slice(index + 1)}`;
    }
    break;
  }
  return line.slice(index);
}

function normalizeFencedContent(lines, indent) {
  return indent === 0 ? lines : lines.map((line) => removeFenceIndent(line, indent));
}

function splitRawText(text, limit) {
  if (text.length <= limit) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > limit) {
    let index = safeSliceIndex(remaining, limit);
    const newline = remaining.lastIndexOf('\n', index - 1);
    if (newline >= 0) index = newline + 1;
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index);
  }
  if (remaining || parts.length === 0) parts.push(remaining);
  return parts;
}

function splitAsFencedCode(text, info, limit) {
  if (limit < 8) return splitRawText(text, limit).map((part) => ({
    markdown: part,
    plain: part,
  }));
  const delimiter = safeCodeFence(text, info);
  let opening = `${delimiter}${info}`;
  if (opening.length + delimiter.length + 2 >= limit) opening = delimiter;
  const payloadLimit = limit - opening.length - delimiter.length - 2;
  if (payloadLimit < 1) return splitRawText(text, limit).map((part) => ({
    markdown: part,
    plain: part,
  }));
  return splitRawText(text, payloadLimit).map((part) => (
    {
      markdown: `${opening}\n${part}${part.endsWith('\n') ? '' : '\n'}${delimiter}`,
      plain: part,
    }
  ));
}

function hasClosingBacktickRun(text, start, length) {
  for (let index = start; index < text.length;) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (text[end] === '`') end += 1;
    if (end - index === length) return true;
    index = end;
  }
  return false;
}

function gfmTableCells(line) {
  const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (normalized.startsWith('    ') || normalized.startsWith('\t')) return null;
  const text = normalized.trim();
  if (!text) return null;

  const cells = [];
  let cell = '';
  let separators = 0;
  let codeRun = 0;
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === '\\' && index + 1 < text.length) {
      cell += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === '`') {
      let end = index + 1;
      while (text[end] === '`') end += 1;
      const length = end - index;
      if (codeRun === length) {
        codeRun = 0;
      } else if (codeRun === 0 && hasClosingBacktickRun(text, end, length)) {
        codeRun = length;
      }
      cell += text.slice(index, end);
      index = end;
      continue;
    }
    if (character === '|' && codeRun === 0) {
      cells.push(cell);
      cell = '';
      separators += 1;
      index += 1;
      continue;
    }
    cell += character;
    index += 1;
  }
  if (separators === 0) return null;
  cells.push(cell);
  if (cells[0].trim() === '') cells.shift();
  if (cells.at(-1)?.trim() === '') cells.pop();
  return cells.length > 0 ? cells : null;
}

function gfmTableStart(lines, index) {
  const headerCells = gfmTableCells(lines[index]);
  const separatorCells = gfmTableCells(lines[index + 1] ?? '');
  if (!headerCells || !separatorCells || headerCells.length !== separatorCells.length) return null;
  if (!separatorCells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))) return null;
  return { headerCells };
}

function supportedTableBodyCells(line) {
  const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
  const content = normalized.replace(/^ {0,3}/, '');
  if (openingFence(normalized)
    || /^(?:#{1,6}(?:[ \t]+|$)|>|(?:[-+*]|\d{1,9}[.)])[ \t]+)/.test(content)) {
    return null;
  }
  return gfmTableCells(normalized);
}

function splitOversizedTable(lines, limit) {
  const source = lines.join('\n');
  if (lines.length < 2 || !gfmTableStart(lines, 0)) {
    return splitAsFencedCode(source, 'text', limit);
  }
  const prefix = `${lines[0]}\n${lines[1]}`;
  const rows = lines.slice(2);
  if (prefix.length > limit
    || rows.some((row) => `${prefix}\n${row}`.length > limit)) {
    return splitAsFencedCode(source, 'text', limit);
  }
  const chunks = [];
  let current = prefix;
  let currentRows = [];
  for (const row of rows) {
    const candidate = `${current}\n${row}`;
    if (candidate.length > limit) {
      chunks.push({
        markdown: current,
        plain: chunks.length === 0 ? current : currentRows.join('\n'),
      });
      current = `${prefix}\n${row}`;
      currentRows = [row];
    } else {
      current = candidate;
      currentRows.push(row);
    }
  }
  chunks.push({
    markdown: current,
    plain: chunks.length === 0 ? current : currentRows.join('\n'),
  });
  return chunks;
}

/**
 * 按换行边界切分 Markdown 文本：
 * - 可容纳的代码块和可识别的 GFM pipe table 保持完整；
 * - 超长代码块会补齐围栏，超长表格会为每段重复表头；
 * - 超长行在 limit 处硬切，避免单行超限无法投递。
 */
export function chunkMarkdownParts(text, limit = DEFAULT_CHUNK_LIMIT) {
  const value = typeof text === 'string' ? text : '';
  const bound = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CHUNK_LIMIT;
  if (value.length <= bound) return value ? [{ markdown: value, plain: value }] : [];

  // Once splitting is required, normalize line endings so a chunk never ends
  // with a dangling CR whose paired LF moved to the next QQ message.
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let current = null;

  const flushCurrent = () => {
    if (current === null) return;
    if (current.length > 0) chunks.push({ markdown: current, plain: current });
    current = null;
  };

  const appendBlock = (block) => {
    if (block.length <= bound) {
      if (current === null) {
        current = block;
        return;
      }
      const candidate = `${current}\n${block}`;
      if (candidate.length > bound) {
        if (current.length > 0) chunks.push({ markdown: current, plain: current });
        current = block;
      } else {
        current = candidate;
      }
      return;
    }
    // 超大块：收束当前块后按 bound 硬切，保证每块可投递。
    flushCurrent();
    let remaining = block;
    while (remaining.length > bound) {
      const index = safeSliceIndex(remaining, bound);
      const part = remaining.slice(0, index);
      chunks.push({ markdown: part, plain: part });
      remaining = remaining.slice(index);
    }
    current = remaining;
  };

  const appendLine = (line) => {
    let remaining = line;
    // 超长行先硬切，保证每块不超过 bound。
    while (remaining.length > bound) {
      flushCurrent();
      const index = safeSliceIndex(remaining, bound);
      const part = remaining.slice(0, index);
      chunks.push({ markdown: part, plain: part });
      remaining = remaining.slice(index);
    }
    appendBlock(remaining);
  };

  for (let index = 0; index < lines.length;) {
    const fence = openingFence(lines[index]);
    if (fence) {
      flushCurrent();
      let end = index + 1;
      while (end < lines.length && !closesFence(lines[end], fence)) end += 1;
      const hasClosingFence = end < lines.length;
      const blockLines = lines.slice(index, hasClosingFence ? end + 1 : lines.length);
      const block = blockLines.join('\n');
      if (block.length <= bound) {
        appendBlock(block);
      } else {
        const contentLines = blockLines.slice(1, hasClosingFence ? -1 : undefined);
        const content = normalizeFencedContent(contentLines, fence.indent).join('\n');
        chunks.push(...splitAsFencedCode(content, fence.info, bound));
      }
      index = hasClosingFence ? end + 1 : lines.length;
      continue;
    }

    if (gfmTableStart(lines, index)) {
      let end = index + 2;
      while (end < lines.length && supportedTableBodyCells(lines[end])) end += 1;
      const tableLines = lines.slice(index, end);
      const table = tableLines.join('\n');
      if (table.length <= bound) {
        appendBlock(table);
      } else {
        flushCurrent();
        chunks.push(...splitOversizedTable(tableLines, bound));
      }
      index = end;
      continue;
    }

    appendLine(lines[index]);
    index += 1;
  }

  flushCurrent();
  return chunks.filter(({ markdown, plain }) => markdown.length > 0 || plain.length > 0);
}

export function chunkMarkdownText(text, limit = DEFAULT_CHUNK_LIMIT) {
  return chunkMarkdownParts(text, limit).map(({ markdown }) => markdown);
}
