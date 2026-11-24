// Independently authored DOCX files for document-update tests: a base document with comments,
// a reply thread, pending tracked changes from two authors, a header, and processor results
// derived from it the way a server-side processor would write them.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

export interface UpdateFixtureOptions {
  /** Body paragraphs, in order; each is complete `w:p` markup. */
  readonly paragraphs: readonly string[];
  /** `w:comment` elements; omit or leave empty for a document without a comments part. */
  readonly comments?: readonly string[];
  /** `w15:commentEx` elements for reply threads. */
  readonly commentsEx?: readonly string[];
  readonly headerText?: string;
  /** Extra body-level relationships, such as a hyperlink or an image. */
  readonly rels?: string;
  readonly media?: Readonly<Record<string, Uint8Array>>;
  /** Children of `w:settings`, such as `w:documentProtection`; omit for no settings part. */
  readonly settings?: string;
}

export const para = (id: string, inner: string): string =>
  `<w:p w14:paraId="${id}" w14:textId="77777777">${inner}</w:p>`;
export const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
export const ins = (id: number, author: string, text: string): string =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="2030-01-0${id % 9}T00:00:00Z">${run(text)}</w:ins>`;
export const del = (id: number, author: string, text: string): string =>
  `<w:del w:id="${id}" w:author="${author}" w:date="2030-02-0${id % 9}T00:00:00Z"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
export const comment = (id: number, author: string, paraId: string, text: string): string =>
  `<w:comment w:id="${id}" w:author="${author}" w:date="2030-03-01T00:00:00Z" w:initials="${author[0]}"><w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
export const commentEx = (paraId: string, parent?: string): string =>
  `<w15:commentEx w15:paraId="${paraId}"${parent ? ` w15:paraIdParent="${parent}"` : ''} w15:done="0"/>`;
export const anchored = (id: number, text: string): string =>
  `<w:commentRangeStart w:id="${id}"/>${run(text)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;

export function updateFixture(options: UpdateFixtureOptions): Uint8Array {
  const comments = options.comments ?? [];
  const hasComments = comments.length > 0;
  const hasEx = (options.commentsEx ?? []).length > 0;
  const overrides = [
    `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>`,
    `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/>`,
    hasComments
      ? `<Override PartName="/word/comments.xml" ContentType="${WML}.comments+xml"/>`
      : '',
    hasEx
      ? `<Override PartName="/word/commentsExtended.xml" ContentType="${WML}.commentsExtended+xml"/>`
      : '',
    options.settings !== undefined
      ? `<Override PartName="/word/settings.xml" ContentType="${WML}.settings+xml"/>`
      : '',
  ].join('');
  const rels = [
    `<Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/>`,
    hasComments ? `<Relationship Id="rId2" Type="${R}/comments" Target="comments.xml"/>` : '',
    hasEx
      ? `<Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>`
      : '',
    options.settings !== undefined
      ? `<Relationship Id="rId4" Type="${R}/settings" Target="settings.xml"/>`
      : '',
    options.rels ?? '',
  ].join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}"><w:body>${options.paragraphs.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:w14="${W14}"><w:p w14:paraId="0A000001"><w:r><w:t>${options.headerText ?? 'Header'}</w:t></w:r></w:p></w:hdr>`
    ),
  };
  if (hasComments)
    files['word/comments.xml'] = strToU8(
      `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${comments.join('')}</w:comments>`
    );
  if (hasEx)
    files['word/commentsExtended.xml'] = strToU8(
      `<w15:commentsEx xmlns:w15="${W15}">${(options.commentsEx ?? []).join('')}</w15:commentsEx>`
    );
  if (options.settings !== undefined)
    files['word/settings.xml'] = strToU8(
      `<w:settings xmlns:w="${W}">${options.settings}</w:settings>`
    );
  for (const [name, bytes] of Object.entries(options.media ?? {})) files[name] = bytes;
  return zipSync(files, { level: 0 });
}

/** The base document: two comments in one thread, pending changes by two authors. */
export const BASE: UpdateFixtureOptions = {
  paragraphs: [
    para('00000001', run('Purpose of this agreement.')),
    para('00000002', `${run('Delivery is due ')}${ins(11, 'Ana', 'next week')}${run('.')}`),
    para('00000003', `${run('Payment terms ')}${del(12, 'Ben', 'thirty')}${run(' sixty days.')}`),
    para('00000004', anchored(1, 'Review this clause.')),
    para('00000005', run('Closing paragraph.')),
  ],
  comments: [
    comment(1, 'Ana', '0B000001', 'Please check.'),
    comment(2, 'Ben', '0B000002', 'Checked.'),
  ],
  commentsEx: [commentEx('0B000001'), commentEx('0B000002', '0B000001')],
};

/** One plain text edit in the first paragraph; everything else exactly as captured. */
export const EDITED: UpdateFixtureOptions = {
  ...BASE,
  paragraphs: [para('00000001', run('Goal of this agreement.')), ...BASE.paragraphs.slice(1)],
};

/** A processor result with its own pending suggestion and a new comment. */
export const SUGGESTED: UpdateFixtureOptions = {
  ...BASE,
  paragraphs: [
    ...BASE.paragraphs.slice(0, 4),
    para(
      '00000006',
      `${run('New clause ')}${ins(21, 'Processor', 'with a suggestion')}${run('.')}`
    ),
    para('00000005', `${anchored(3, 'Closing')}${run(' paragraph.')}`),
  ],
  comments: [...(BASE.comments ?? []), comment(3, 'Processor', '0B000003', 'Added by processor.')],
  commentsEx: [...(BASE.commentsEx ?? []), commentEx('0B000003')],
};

/** Removes a paragraph, changes the header, and drops the reply thread. */
export const RESTRUCTURED: UpdateFixtureOptions = {
  ...BASE,
  paragraphs: [BASE.paragraphs[0]!, BASE.paragraphs[2]!, BASE.paragraphs[3]!, BASE.paragraphs[4]!],
  headerText: 'Revised header',
  comments: [BASE.comments![0]!],
  commentsEx: [BASE.commentsEx![0]!],
};

/** A document with no comments part at all. */
export const PLAIN: UpdateFixtureOptions = {
  paragraphs: [para('00000001', run('Plain body.')), para('00000002', run('Second.'))],
};

/** The plain document after a processor added the first comment, so a new part appears. */
export const FIRST_COMMENT: UpdateFixtureOptions = {
  paragraphs: [para('00000001', anchored(1, 'Plain body.')), para('00000002', run('Second.'))],
  comments: [comment(1, 'Processor', '0B000001', 'First comment.')],
};
