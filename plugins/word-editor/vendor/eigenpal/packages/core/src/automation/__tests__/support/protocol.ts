// Fixtures and readers shared by the object-model protocol tests.
//
// Real packages, never a fake host: the point of these tests is that the operations reach the
// canonical tree and the one transaction path, so a stub would let the protocol agree with
// itself and prove nothing.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createServerAutomationHost } from '../../server-host.ts';
import type {
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
  AutomationSpan,
} from '../../protocol.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

/** Extra markup a fixture needs beside the body. */
export interface DocxExtras {
  /** Raw `<Relationship .../>` elements for `word/_rels/document.xml.rels`. */
  readonly rels?: string;
}

/** A package, optionally with a real `styles.xml` — the `w:style` children go in `styles`. */
export function docx(body: string, styles?: string, extras: DocxExtras = {}): Uint8Array {
  const extraRels = extras.rels ?? '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (styles === undefined
          ? ''
          : `<Override PartName="/word/styles.xml" ContentType="${STYLES_CT}"/>`) +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (styles === undefined
          ? ''
          : `<Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/>`) +
        extraRels +
        `</Relationships>`
    ),
    ...(styles === undefined
      ? {}
      : { 'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`) }),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}">` +
        `<w:body>${body}</w:body></w:document>`
    ),
  });
}

export const p = (text: string): string =>
  text.length === 0 ? `<w:p/>` : `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** A paragraph that already carries the identity Word writes, so nothing is minted for it. */
export const pWithId = (text: string, paraId: string): string =>
  `<w:p w14:paraId="${paraId}" w14:textId="${paraId}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/**
 * A paragraph that ENDS A SECTION: its mark carries a `w:sectPr` (17.6.17).
 *
 * Removing such a paragraph would merge its section into the next one, taking that section's
 * page size and headers over every page it governed, so the store refuses to delete it. It is
 * here because "empty the whole story" has to mean something for a document with two sections.
 */
export const pWithSection = (text: string): string =>
  `<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

export const cell = (...blocks: string[]): string => `<w:tc>${blocks.join('')}</w:tc>`;
export const row = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`;
export const table = (...rows: string[]): string => `<w:tbl>${rows.join('')}</w:tbl>`;
/** A block-level content control wrapping blocks. `deleteBlock` does not name one. */
export const sdt = (...blocks: string[]): string =>
  `<w:sdt><w:sdtPr/><w:sdtContent>${blocks.join('')}</w:sdtContent></w:sdt>`;

/** The saved `word/document.xml`, for assertions about markup an edit had to keep. */
export function savedMainXml(host: AutomationHost): string {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save refused: ${saved.error.code}`);
  return strFromU8(unzipSync(saved.bytes)['word/document.xml'] as Uint8Array);
}

/**
 * The saved bytes of ONE part, for the differential assertions a refusal has to satisfy.
 *
 * Bytes rather than a parsed shape: "this refusal changed nothing" is a claim about the file, and
 * a comparison of two derived pictures can agree while the markup between them differs.
 */
export function savedPartBytes(host: AutomationHost, name: string): string {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save refused: ${saved.error.code}`);
  const part = unzipSync(saved.bytes)[name];
  return part === undefined ? '' : strFromU8(part);
}

export function open(bytes: Uint8Array): AutomationHost {
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error(`fixture host did not open: ${opened.reason}`);
  return opened.host;
}

export interface Roots {
  readonly document: AutomationHandle;
  readonly body: AutomationHandle;
}

/**
 * Save the host's document and open the bytes again.
 *
 * The fidelity assertion every edit test ends with: an edit that reads back correctly in the
 * session that made it but does not survive the serializer has not been applied to a document,
 * only to a picture of one. Handles do NOT carry over — a new host draws its own token — so the
 * reopened body is asked its paragraphs afresh, which is also the point.
 */
export function reopen(host: AutomationHost): Roots & { readonly host: AutomationHost } {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save refused: ${saved.error.code}`);
  const next = open(saved.bytes);
  return { host: next, ...roots(next) };
}

export function roots(host: AutomationHost): Roots {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  return { document, body };
}

export function handleAt(response: AutomationBatchResponse, index: number): AutomationHandle {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`expected a handle at ${index}: ${describe(response, index)}`);
  }
  return result.value.handle;
}

export function handlesAt(
  response: AutomationBatchResponse,
  index: number
): readonly AutomationHandle[] {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error(`expected handles at ${index}: ${describe(response, index)}`);
  }
  return result.value.handles;
}

export function textAt(response: AutomationBatchResponse, index: number): string {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'text') {
    throw new Error(`expected text at ${index}: ${describe(response, index)}`);
  }
  return result.value.text;
}

/**
 * The span's position without the host's `readAt` stamp, which `automation-stale-spans.test.ts`
 * covers. Tests here compare where a span is; the stamp says when it was read.
 */
function positionOf(span: AutomationSpan): AutomationSpan {
  const { readAt: _start, ...start } = span.start;
  const { readAt: _end, ...end } = span.end;
  return { start, end };
}

export function spanAt(response: AutomationBatchResponse, index: number): AutomationSpan {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'span') {
    throw new Error(`expected a span at ${index}: ${describe(response, index)}`);
  }
  return positionOf(result.value.span);
}

export function spansAt(
  response: AutomationBatchResponse,
  index: number
): readonly AutomationSpan[] {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'spans') {
    throw new Error(`expected spans at ${index}: ${describe(response, index)}`);
  }
  return result.value.spans.map(positionOf);
}

export function errorAt(response: AutomationBatchResponse, index: number): string {
  const result = response.results[index];
  if (result?.status !== 'error') throw new Error(`expected an error at ${index}`);
  return result.error.code;
}

/** The one failing operation's code, wherever in the batch it is. */
export function refusal(response: AutomationBatchResponse): string {
  for (const result of response.results) {
    if (result.status === 'error') return result.error.code;
  }
  throw new Error('the batch reported no failure');
}

function describe(response: AutomationBatchResponse, index: number): string {
  const result = response.results[index];
  if (!result) return 'no result';
  if (result.status === 'error') return `${result.error.code}/${result.error.detail ?? ''}`;
  return result.status;
}

/** Paragraph handles of the main body, in reading order. */
export function paragraphsOf(host: AutomationHost, body: AutomationHandle) {
  return handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
}

/** Every body paragraph's text, in reading order — one call, for readable assertions. */
export function paragraphTexts(host: AutomationHost, body: AutomationHandle): string[] {
  const list = paragraphsOf(host, body);
  const response = host.execute({
    operations: list.map((paragraph) => ({ op: 'getText' as const, target: paragraph })),
  });
  return list.map((_, index) => textAt(response, index));
}

export function storyText(host: AutomationHost, body: AutomationHandle): string {
  return textAt(host.execute({ operations: [{ op: 'getText', target: body }] }), 0);
}

/** Add complete real numbering definitions to a list fixture. */
export function withNumbering(bytes: Uint8Array, ids: readonly string[]): Uint8Array {
  const files = unzipSync(bytes);
  files['word/numbering.xml'] = strToU8(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/></w:lvl>`).join('')}</w:abstractNum>${ids.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="0"/></w:num>`).join('')}</w:numbering>`
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    )
  );
  const rels = files['word/_rels/document.xml.rels'];
  files['word/_rels/document.xml.rels'] = strToU8(
    (rels ? strFromU8(rels) : `<Relationships xmlns="${REL}"></Relationships>`).replace(
      '</Relationships>',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'
    )
  );
  return zipSync(files);
}
