// Tracked changes in clipboard HTML, read back as revisions.
//
// A word processor copies tracked text as `<ins>` and `<del>` elements. `cite` holds the author
// as a `mailto:` URI and `datetime` holds the revision date to the minute. An `<o:p>` inside
// one of them says the paragraph mark was inserted or deleted. A formatting change is a
// `mso-prop-change:"Author" 20260304T0506` declaration, and every property it changed keeps
// its previous value in a declaration marked `!msorm`. A table row carries
// `mso-table-inserted` or `mso-table-deleted`.
//
// Every value here is clipboard-supplied. Authors are decoded, stripped of characters XML
// cannot hold, capped, and escaped. Dates must match a fixed digit pattern with in-range
// fields, or the revision is written without one. Revision ids are written as a placeholder
// and numbered once per paste (`numberHtmlRevisionIds`); the merge then renumbers them
// against the target document.

import { escapeXmlAttribute } from '../store/package/sinks.ts';
import { xmlSafeText } from './clipboard-html-xml.ts';
import type { HtmlRunProps } from './clipboard-html-styles.ts';

/** One `<ins>` or `<del>` read as a revision. */
export interface HtmlRevision {
  readonly kind: 'ins' | 'del';
  readonly author: string;
  /** `ST_DateTime`, or absent when the HTML gave none that parses. */
  readonly date?: string;
}

/** The author and date of a `mso-prop-change` formatting revision. */
export type HtmlRevisionAttribution = Omit<HtmlRevision, 'kind'>;

/** The author a revision gets when the HTML names none. */
const UNKNOWN_AUTHOR = 'Unknown';
const MAX_AUTHOR_LENGTH = 255;
/** Replaced by `numberHtmlRevisionIds`; cannot come from escaped clipboard text. */
const REVISION_ID_PLACEHOLDER = 'w:id="?"';

function cleanAuthor(raw: string | null | undefined): string {
  const text = xmlSafeText(raw ?? '')
    .replace(/[\t\n\r]+/g, ' ')
    .trim()
    .slice(0, MAX_AUTHOR_LENGTH);
  return text.length > 0 ? text : UNKNOWN_AUTHOR;
}

/** `mailto:Ann%20Author` → `Ann Author`. Any other `cite` names no author. */
function authorFromCite(cite: string | null): string {
  if (cite === null || cite.length > 4 * MAX_AUTHOR_LENGTH) return UNKNOWN_AUTHOR;
  const match = /^\s*mailto:(.*)$/i.exec(cite);
  if (!match) return UNKNOWN_AUTHOR;
  let decoded = match[1]!;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A malformed escape keeps the raw text: still the author, only less readable.
  }
  return cleanAuthor(decoded);
}

function inRange(value: string, low: number, high: number): boolean {
  const number = Number(value);
  return number >= low && number <= high;
}

/** A dated revision to the minute, the precision the clipboard carries. */
function revisionDate(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string
): string | undefined {
  if (!inRange(year, 1, 9999) || !inRange(month, 1, 12)) return undefined;
  if (!inRange(hour, 0, 23) || !inRange(minute, 0, 59)) return undefined;
  // A day the month does not have (February 31) is not a date at all.
  const days = new Date(Date.UTC(2000, Number(month), 0)).getUTCDate();
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  if (!inRange(day, 1, month === '02' && !leap ? 28 : days)) return undefined;
  return `${year}-${month}-${day}T${hour}:${minute}:00Z`;
}

/** `datetime="2026-03-04T05:06"` (seconds and zone, when present, are dropped). */
function dateFromDatetime(value: string | null): string | undefined {
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  return match ? revisionDate(match[1]!, match[2]!, match[3]!, match[4]!, match[5]!) : undefined;
}

/** `"Ann Author" 20260304T0506`, the value of `mso-prop-change` and the row markers. */
function attributionFromMso(value: string | undefined): HtmlRevisionAttribution | null {
  if (value === undefined || value.length > 4 * MAX_AUTHOR_LENGTH) return null;
  const match = /^\s*"([^"]*)"\s+(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(value);
  if (!match) return null;
  const date = revisionDate(match[2]!, match[3]!, match[4]!, match[5]!, match[6]!);
  return { author: cleanAuthor(match[1]), ...(date === undefined ? {} : { date }) };
}

/**
 * The revision an `<ins>` or `<del>` element records, or `null` when it is only formatting.
 *
 * In word processor clipboard HTML it always means a revision. Elsewhere, only an element whose `cite` names
 * an author does: a web page's `<del>` is usually a styled price or a correction, and it
 * keeps pasting as struck text.
 */
export function htmlRevisionOf(
  element: Element,
  tag: string,
  wordHtml: boolean
): HtmlRevision | null {
  if (tag !== 'ins' && tag !== 'del') return null;
  const cite = element.getAttribute('cite');
  if (!wordHtml && !/^\s*mailto:/i.test(cite ?? '')) return null;
  const date = dateFromDatetime(element.getAttribute('datetime'));
  return { kind: tag, author: authorFromCite(cite), ...(date === undefined ? {} : { date }) };
}

function attributesXml(attribution: HtmlRevisionAttribution): string {
  return (
    `${REVISION_ID_PLACEHOLDER} w:author="${escapeXmlAttribute(attribution.author)}"` +
    (attribution.date === undefined ? '' : ` w:date="${attribution.date}"`)
  );
}

/** Our own emitted `w:t`, renamed for deleted content. Clipboard text is escaped already. */
function asDeletedText(piece: string): string {
  return piece.replace(/<w:t(?=[ >/])/g, '<w:delText').replace(/<\/w:t>/g, '</w:delText>');
}

const BOOKMARKS_ONLY = /^(?:<w:bookmark(?:Start|End)\b[^>]*\/>)+$/;

/**
 * Wrap the pieces an `<ins>` or `<del>` produced in the revision element.
 *
 * A hyperlink cannot sit inside `w:ins` or `w:del` (`CT_RunTrackChange` takes
 * `EG_ContentRunContent`). The hyperlink branch wraps its own content instead
 * (`wrapInRevisions`), so a hyperlink piece passes through here. Bookmark-only pieces pass
 * through too, so the walk still recognises them as furniture.
 */
export function wrapRevisionPieces(revision: HtmlRevision, pieces: readonly string[]): string[] {
  const out: string[] = [];
  let group = '';
  const close = (): void => {
    if (group.length === 0) return;
    out.push(`<w:${revision.kind} ${attributesXml(revision)}>${group}</w:${revision.kind}>`);
    group = '';
  };
  for (const raw of pieces) {
    const piece = revision.kind === 'del' ? asDeletedText(raw) : raw;
    if (piece.includes('<w:hyperlink') || BOOKMARKS_ONLY.test(piece)) {
      close();
      out.push(piece);
    } else {
      group += piece;
    }
  }
  close();
  return out;
}

/** Hyperlink content wrapped in every open revision, outermost first. */
export function wrapInRevisions(revisions: readonly HtmlRevision[], content: string): string {
  let wrapped = content;
  for (let index = revisions.length - 1; index >= 0; index -= 1) {
    const revision = revisions[index]!;
    const inner = revision.kind === 'del' ? asDeletedText(wrapped) : wrapped;
    wrapped = `<w:${revision.kind} ${attributesXml(revision)}>${inner}</w:${revision.kind}>`;
  }
  return wrapped;
}

/**
 * The paragraph mark revisions for an `<o:p>` inside open revisions: `w:ins` and `w:del`,
 * in `CT_ParaRPr` order.
 */
export function paragraphMarkRevisionXml(revisions: readonly HtmlRevision[]): string {
  const inserted = revisions.find((revision) => revision.kind === 'ins');
  const deleted = revisions.find((revision) => revision.kind === 'del');
  return (
    (inserted ? `<w:ins ${attributesXml(inserted)}/>` : '') +
    (deleted ? `<w:del ${attributesXml(deleted)}/>` : '')
  );
}

/** The formatting revision a `mso-prop-change` declaration records. */
export function propertyChangeOf(
  style: ReadonlyMap<string, string>
): HtmlRevisionAttribution | null {
  return attributionFromMso(style.get('mso-prop-change'));
}

/** `w:trPr` revision children for `mso-table-inserted` / `mso-table-deleted`. */
export function rowRevisionXml(style: ReadonlyMap<string, string>): string {
  const inserted = attributionFromMso(style.get('mso-table-inserted'));
  const deleted = attributionFromMso(style.get('mso-table-deleted'));
  return (
    (inserted ? `<w:ins ${attributesXml(inserted)}/>` : '') +
    (deleted ? `<w:del ${attributesXml(deleted)}/>` : '')
  );
}

/** Whether a declaration value is a previous value (`font-weight:normal !msorm`). */
export function isOriginalValue(value: string): boolean {
  return /!\s*msorm\s*$/i.test(value);
}

/**
 * The element's `!msorm` declarations: the values its formatting revision replaced, merged
 * over `inherited` (an inner element's declaration wins). `inherited` comes back by identity
 * when the element has none.
 */
export function originalStyleOf(
  element: Element,
  inherited: ReadonlyMap<string, string> | undefined
): ReadonlyMap<string, string> | undefined {
  const raw = element.getAttribute('style');
  if (!raw || raw.length > 8192 || !/msorm/i.test(raw)) return inherited;
  const out = new Map(inherited);
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const value = declaration.slice(colon + 1).trim();
    if (!isOriginalValue(value)) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    out.set(name, value.replace(/!\s*msorm\s*$/i, '').trim());
  }
  return out;
}

/** `w:rPrChange` for a run whose previous properties are `original`. */
export function runPropertyChangeXml(
  attribution: HtmlRevisionAttribution,
  originalRPr: string
): string {
  return `<w:rPrChange ${attributesXml(attribution)}>${originalRPr || '<w:rPr/>'}</w:rPrChange>`;
}

/** `w:pPrChange` for a paragraph whose previous properties are `originalPPr`. */
export function paragraphPropertyChangeXml(
  attribution: HtmlRevisionAttribution,
  originalPPr: string
): string {
  return `<w:pPrChange ${attributesXml(attribution)}>${originalPPr || '<w:pPr/>'}</w:pPrChange>`;
}

/** Run properties without the formatting revision they carry. */
export function withoutPropertyChange(props: HtmlRunProps): HtmlRunProps {
  if (props.changeXml === undefined) return props;
  const { changeXml: _changeXml, ...rest } = props;
  return rest;
}

/** Give every revision placeholder in the projected blocks its own id, in document order. */
export function numberHtmlRevisionIds(blockLists: readonly string[][]): void {
  let next = 0;
  for (const blocks of blockLists) {
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      if (!block.includes(REVISION_ID_PLACEHOLDER)) continue;
      blocks[index] = block.replaceAll(REVISION_ID_PLACEHOLDER, () => `w:id="${next++}"`);
    }
  }
}
