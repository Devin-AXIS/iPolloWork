// The plain text behind a clipboard or drag payload (paginated-surface seam).
//
// Paste stays PLAIN TEXT only — pasted markup is attacker-controlled and rich paste
// belongs behind the same bounded parse the file path uses. But a payload that carries
// `text/html` WITHOUT a `text/plain` flavour used to paste nothing at all, silently: the
// handler prevented the browser's default and then returned on the empty string. A few
// real applications write only the HTML flavour, and for them the editor simply looked
// broken.
//
// So the HTML flavour is read for its TEXT, never for its structure. This is a string
// transform end to end: no `innerHTML`, no `DOMParser`, no DOM built from the payload at
// all, so there is no markup sink to escape from. Whatever comes out is inserted through
// the same path typed text takes, which only ever produces text runs — the worst case for
// a payload this function mis-reads is odd characters, never live markup.

/**
 * The most text this will pull out of one payload.
 *
 * A clipboard is as attacker-controlled as a file: the cap keeps a hostile multi-megabyte
 * payload from turning into an unbounded run of work in the transform below and an
 * unbounded insert afterwards. Truncating beats the old behaviour of dropping silently.
 */
const MAX_HTML_INPUT = 2_000_000;

/** Named entities worth decoding; anything else numeric is handled separately. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // A real U+00A0, written as an escape so it is not an invisible literal in the
  // source. It stays non-breaking rather than collapsing to a space: it is a distinct
  // character with distinct line-breaking behaviour, and Word preserves it too.
  nbsp: '\u00a0',
};

/**
 * Decode character references.
 *
 * Runs LAST, after every tag has already been removed, which is what makes it safe: an
 * authored `&lt;script&gt;` becomes the literal characters `<script>` only once nothing
 * downstream will read them as a tag again.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const codePoint = body.startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Surrogates and out-of-range values would throw in fromCodePoint; a payload that
      // names one keeps its literal text rather than taking the paste down with it.
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
      return String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Tags whose CONTENT is never visible text: the whole element is dropped. `title` and
 * `template` join `script`/`style` because a full-document clipboard flavour (a browser's
 * "copy image", say) carries a page title no reader ever saw — pasting it inserted the
 * word instead of nothing, and made the payload read as text-bearing to the paste lanes.
 */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'title', 'template']);
/** Close tags that end a block, so what follows starts a new line. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'section',
  'article',
  'pre',
  'table',
]);
/** Close tags that end a table cell, which reads as a tab like a copied cell range. */
const CELL_TAGS = new Set(['td', 'th']);

const isNameStart = (char: string | undefined): boolean =>
  char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z'));
const isNameChar = (char: string | undefined): boolean =>
  isNameStart(char) || (char !== undefined && char >= '0' && char <= '9');
const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

interface ScannedTag {
  readonly name: string;
  readonly closing: boolean;
  /** Index just past the `>`, or the end of input for an unterminated tag. */
  readonly end: number;
}

/**
 * Read the tag that starts at `start`, or null when that `<` is only literal text.
 *
 * Quoted attribute values may hold a `>`; a browser does not end the tag there, so neither
 * does this. But ONLY a quote that opens a value counts — the one directly after an `=`.
 * An apostrophe anywhere else is an ordinary character inside an unquoted value, exactly as
 * a browser reads it, and treating `title=it's` as an opening quote sent the scan looking
 * for a partner that never came and swallowed the rest of the paste.
 *
 * Each call consumes what it scans, which keeps the whole walk linear.
 */
function scanTag(html: string, start: number): ScannedTag | null {
  let at = start + 1;
  const closing = html[at] === '/';
  if (closing) at += 1;
  if (!isNameStart(html[at])) return null;
  const nameStart = at;
  while (at < html.length && isNameChar(html[at])) at += 1;
  const name = html.slice(nameStart, at).toLowerCase();
  let quote = '';
  let afterEquals = false;
  while (at < html.length) {
    const char = html[at]!;
    if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '=') {
      afterEquals = true;
    } else if (afterEquals && (char === '"' || char === "'")) {
      quote = char;
      afterEquals = false;
    } else if (char === '>') {
      return { name, closing, end: at + 1 };
    } else if (!isSpace(char)) {
      afterEquals = false;
    }
    at += 1;
  }
  return { name, closing, end: html.length };
}

/**
 * A line without the tabs a final cell in each row leaves behind.
 *
 * Written as a backward walk rather than `/\t+\n/g`, which backtracks over every position of
 * a tab run: `</td>` emits exactly one tab, so a payload of nothing but close-cell tags is a
 * solid run of them under a sender's control, and at the input cap that regex cost about a
 * minute of blocked main thread.
 */
function withoutTrailingTabs(line: string): string {
  let end = line.length;
  while (end > 0 && line.charCodeAt(end - 1) === 0x09) end -= 1;
  return end === line.length ? line : line.slice(0, end);
}

/**
 * The index just past `</name>`, or the end of input when it never closes.
 *
 * An unclosed `<script>` drops everything after it rather than pasting its body.
 */
function rawTextEnd(html: string, name: string, from: number): number {
  for (let at = from; at < html.length;) {
    const close = html.indexOf('</', at);
    if (close === -1) return html.length;
    let after = close + 2;
    if (html.slice(after, after + name.length).toLowerCase() === name) {
      after += name.length;
      while (after < html.length && isSpace(html[after])) after += 1;
      if (html[after] === '>') return after + 1;
    }
    at = close + 2;
  }
  return html.length;
}

/**
 * The text pieces of an HTML fragment, in document order.
 *
 * One forward walk shared by the full transform below and the early-exit predicate — every
 * branch moves the cursor forward over a range the next branch will not revisit, so a
 * hostile payload costs at most one pass over its own length. Yields raw text slices plus
 * the `\n`/`\t` a block or cell boundary reads as; entity references are NOT decoded here.
 */
function* htmlTextPieces(bounded: string): Generator<string> {
  let at = 0;
  while (at < bounded.length) {
    const open = bounded.indexOf('<', at);
    if (open === -1) {
      yield bounded.slice(at);
      break;
    }
    if (open > at) yield bounded.slice(at, open);
    // Comments first: they can contain anything, including tag-shaped text.
    if (bounded.startsWith('<!--', open)) {
      // `<!-->` and `<!--->` close AT ONCE. Demanding a full `-->` after them found no
      // terminator and swallowed the rest of the payload — five characters at the head of
      // a paste were enough to drop all of it.
      if (bounded[open + 4] === '>') {
        at = open + 5;
        continue;
      }
      if (bounded[open + 4] === '-' && bounded[open + 5] === '>') {
        at = open + 6;
        continue;
      }
      const close = bounded.indexOf('-->', open + 4);
      at = close === -1 ? bounded.length : close + 3;
      continue;
    }
    // Doctypes, processing instructions and bogus comments run to the next `>`.
    if (bounded[open + 1] === '!' || bounded[open + 1] === '?') {
      const close = bounded.indexOf('>', open + 1);
      at = close === -1 ? bounded.length : close + 1;
      continue;
    }
    const tag = scanTag(bounded, open);
    if (tag === null) {
      // A `<` that starts no tag is text, exactly as a browser reads it.
      yield '<';
      at = open + 1;
      continue;
    }
    at = tag.end;
    if (!tag.closing && RAW_TEXT_TAGS.has(tag.name)) {
      at = rawTextEnd(bounded, tag.name, tag.end);
    } else if (!tag.closing && tag.name === 'br') {
      yield '\n';
    } else if (tag.closing && CELL_TAGS.has(tag.name)) {
      yield '\t';
    } else if (tag.closing && BLOCK_TAGS.has(tag.name)) {
      yield '\n';
    }
  }
}

/**
 * The visible text of an HTML fragment.
 *
 * A single forward walk (see {@link htmlTextPieces}), not a sequence of `replace` passes.
 * The walk never re-reads what it has already written, so no later stage can turn emitted
 * text back into a tag.
 *
 * It does NOT promise the output holds no angle brackets. A payload may write a literal `<`
 * that a browser also shows as text, and removing the element after it can leave that `<`
 * beside a word. That is fine here and only here: the result is inserted as run text through
 * the same path typed characters take, and is escaped again on save. Nothing re-parses it.
 *
 * Block boundaries become newlines and table cells become tabs, matching how this engine
 * already flattens a copied cell range — so an HTML table pasted here lands in the same
 * shape a table copied out of the document does.
 */
export function plainTextFromHtml(html: string): string {
  const bounded = html.length > MAX_HTML_INPUT ? html.slice(0, MAX_HTML_INPUT) : html;
  let text = '';
  for (const piece of htmlTextPieces(bounded)) text += piece;
  return (
    decodeEntities(text)
      // Collapse the runs of blank lines that block-level markup leaves behind, and drop
      // the trailing tab a final cell contributes.
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(withoutTrailingTabs)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Make pasted text insertable, or the whole paste is refused and NOTHING happens.
 *
 * Run text is serialized into XML, so the store validates every `insertText` against XML
 * 1.0 and rejects the op if it fails — and one rejected op vetoes the atomic transaction.
 * A single stray control character therefore turned an entire paste into a silent no-op.
 *
 * This is not a hypothetical payload. `selectedText()` writes U+000C for a page break, so
 * copying any range that spans one produced text this editor could not paste back into
 * itself: Select All, Copy, Paste did nothing on any document longer than a page.
 *
 * The form feed becomes a paragraph break, which is the honest paragraph-lane reading of a
 * page break — the same reading a newline already gets. Every other character XML 1.0
 * forbids is dropped: a control character has no representation in run text, and losing it
 * beats losing the paste. Mirrors `isValidXmlText` in store/package/sinks.ts; the two must
 * agree, or this silently hands the store something it will refuse.
 */
export function insertableText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    // A page break reads as a paragraph break; CRLF/CR normalize with it.
    if (unit === 0x0c) {
      out += '\n';
      continue;
    }
    if (unit === 0x0d) {
      out += '\n';
      if (text.charCodeAt(i + 1) === 0x0a) i += 1;
      continue;
    }
    if (unit === 0x09 || unit === 0x0a) {
      out += text[i]!;
      continue;
    }
    if (unit < 0x20 || unit === 0xfffe || unit === 0xffff) continue;
    // Surrogates only survive as a well-formed pair; a lone one is refused by the store,
    // and truncating a payload mid-pair is an easy way to produce one.
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      }
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) continue;
    out += text[i]!;
  }
  return out;
}

/**
 * A character the reader can actually see: not whitespace, and not one of the zero-width
 * or invisible-format characters (zero-widths, bidi marks and isolates, `U+2060`,
 * `U+FEFF`, soft hyphen) some
 * applications wrap around inline content. Those survive `trim()` and would make an
 * effectively empty payload read as "carries text".
 */
const VISIBLE_CHAR = /[^\s\u200B-\u200F\u2060\u2066-\u2069\u061C\uFEFF\u00AD]/;

/** Whether the text holds at least one character the reader can see. */
export function hasVisibleChar(text: string): boolean {
  return VISIBLE_CHAR.test(text);
}

/**
 * Early-exit visible-text scan: stops at the first visible character instead of
 * materializing the whole payload's text the way {@link plainTextFromHtml} does. The two
 * share {@link htmlTextPieces} and the same input cap, so they agree on WHERE text is —
 * this one only answers sooner.
 */
export function htmlHasVisibleText(html: string): boolean {
  const bounded = html.length > MAX_HTML_INPUT ? html.slice(0, MAX_HTML_INPUT) : html;
  for (const piece of htmlTextPieces(bounded)) {
    // Entities decode per piece only when one can be present; a reference split across
    // pieces by markup may still read as visible here — the full transform concatenates
    // before decoding, so on such (hand-crafted) payloads this over-reports visibility.
    const text = piece.includes('&') ? decodeEntities(piece) : piece;
    if (VISIBLE_CHAR.test(text)) return true;
  }
  return false;
}

/**
 * The text a paste or drop should insert, whatever flavours the payload carries.
 *
 * `text/plain` wins whenever it is present — it is what the source application chose to
 * say. The HTML flavour is a fallback for payloads that omit it, not a richer path.
 */
export function plainTextFromTransfer(data: DataTransfer | null | undefined): string {
  if (!data) return '';
  const plain = data.getData('text/plain');
  if (plain.length > 0) return plain;
  const html = data.getData('text/html');
  if (html.length > 0) return plainTextFromHtml(html);
  return '';
}
