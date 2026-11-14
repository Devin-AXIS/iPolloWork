export const TELEGRAM_RICH_TEXT_LIMIT = 30_000;
export const TELEGRAM_REGULAR_TEXT_LIMIT = 4_000;

function textValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('Telegram message text must be a non-empty string');
  }
  return value;
}

function escapedCharacterLength(value) {
  if (value === '&') return 5;
  if (value === '<' || value === '>') return 4;
  return 1;
}

function escapedLength(value) {
  return Array.from(value).reduce((total, character) => (
    total + escapedCharacterLength(character)
  ), 0);
}

function preferredCut(points, offset, hardEnd, limit) {
  const minimum = offset + Math.floor(limit * 0.5);
  for (let index = hardEnd - 1; index >= minimum; index -= 1) {
    if (points[index] === '\n' || points[index] === ' ') return index + 1;
  }
  return hardEnd;
}

function splitText(value, limit, characterLength = () => 1) {
  if (typeof value !== 'string') throw new TypeError('Telegram message text must be a string');
  if (!value) return [];
  const points = Array.from(value);
  const chunks = [];
  let offset = 0;
  while (offset < points.length) {
    let end = offset;
    let length = 0;
    while (end < points.length) {
      const nextLength = characterLength(points[end]);
      if (length + nextLength > limit) break;
      length += nextLength;
      end += 1;
    }
    if (end === offset) throw new Error('Telegram message character exceeds the chunk limit');
    if (end < points.length) end = preferredCut(points, offset, end, limit);
    chunks.push(points.slice(offset, end).join(''));
    offset = end;
  }
  return chunks;
}

function fenceMarkers(markdown) {
  return [...markdown.matchAll(/^```[^\n]*(?:\n|$)/gm)];
}

function assertCompleteFences(markdown) {
  const markers = fenceMarkers(markdown);
  if (markers.length % 2 !== 0) {
    throw new Error('Telegram Rich Markdown contains an unfinished code fence');
  }
  return markers;
}

function escapedMarkdown(value) {
  return Array.from(value, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return character;
  }).join('');
}

function plainRichChunks(source, limit) {
  return splitText(source, limit, escapedCharacterLength).map((chunk) => ({
    source: chunk,
    markdown: escapedMarkdown(chunk),
  }));
}

function fencedRichChunks(source, opening, closing, limit) {
  const body = source.slice(opening.length, source.length - closing.length);
  const wrapperLength = escapedLength(opening)
    + Math.max(escapedLength(closing), escapedLength('```'))
    + 1;
  const bodyLimit = limit - wrapperLength;
  if (bodyLimit < 1) throw new Error('Telegram Rich Markdown code fence exceeds the limit');
  const bodyChunks = splitText(body, bodyLimit, escapedCharacterLength);
  return bodyChunks.map((bodyChunk, index) => {
    const last = index === bodyChunks.length - 1;
    const separator = bodyChunk.endsWith('\n') ? '' : '\n';
    const renderedClosing = last ? closing : '```';
    const sourceChunk = `${index === 0 ? opening : ''}${bodyChunk}${last ? closing : ''}`;
    const markdown = escapedMarkdown(`${opening}${bodyChunk}${separator}${renderedClosing}`);
    if (Array.from(markdown).length > limit) {
      throw new Error('Telegram Rich Markdown code block exceeds the limit');
    }
    return { source: sourceChunk, markdown };
  });
}

export function toTelegramRichMarkdown(value) {
  const markdown = textValue(value);
  assertCompleteFences(markdown);
  // Rich Markdown also accepts HTML tags. Escape entities first so encoded or
  // raw model output cannot be interpreted as Telegram-specific markup.
  return escapedMarkdown(markdown);
}

export function splitTelegramRichMarkdown(value, limit = TELEGRAM_RICH_TEXT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 128 || limit > 32_768) {
    throw new TypeError('Telegram Rich Markdown limit is invalid');
  }
  const source = textValue(value);
  const markers = assertCompleteFences(source);
  const complete = escapedMarkdown(source);
  if (Array.from(complete).length <= limit) return [{ source, markdown: complete }];

  const chunks = [];
  let cursor = 0;
  for (let index = 0; index < markers.length; index += 2) {
    const opening = markers[index];
    const closing = markers[index + 1];
    if (opening.index > cursor) {
      chunks.push(...plainRichChunks(source.slice(cursor, opening.index), limit));
    }
    const end = closing.index + closing[0].length;
    const fenced = source.slice(opening.index, end);
    const rendered = escapedMarkdown(fenced);
    if (Array.from(rendered).length <= limit) {
      chunks.push({ source: fenced, markdown: rendered });
    } else {
      chunks.push(...fencedRichChunks(fenced, opening[0], closing[0], limit));
    }
    cursor = end;
  }
  if (cursor < source.length) chunks.push(...plainRichChunks(source.slice(cursor), limit));
  return chunks;
}

export function splitTelegramRegularText(value, limit = TELEGRAM_REGULAR_TEXT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4_096) {
    throw new TypeError('Telegram regular message limit is invalid');
  }
  // Keep Telegram's established 4000 UTF-16-unit boundary without ever cutting
  // a surrogate pair in half.
  return splitText(textValue(value), limit, (character) => character.length);
}
