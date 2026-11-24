// Shared OOXML snippets for comment-lifecycle / reap tests.
//
// Small hand-built packages, not the comprehensive fixture: the adversarial cases need
// duplicate ids, extra parts, and wrong content types the engine would not author.

import { strToU8, zipSync } from 'fflate';
import {
  commentPartNameOf,
  commentsOfPart,
  readOoxmlPackage,
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
export const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
export const W16CID = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EXTENDED_REL = 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const IDS_REL = 'http://schemas.microsoft.com/office/2016/relationships/commentsIds';
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const EXTENDED_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml';
const IDS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml';
const HEADER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';

export function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += textOf(child);
  return text;
}

export function paragraphContaining(
  root: OoxmlNode,
  needle: string
): { id: string; length: number } {
  let found: { id: string; length: number } | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const text = textOf(node);
      if (text.includes(needle)) found = { id: node.id, length: text.length };
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  if (!found) throw new Error(`no paragraph containing ${JSON.stringify(needle)}`);
  return found;
}

export function markersUnder(root: OoxmlNode, commentId: string): string[] {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (
      node.kind === 'commentRangeStart' ||
      node.kind === 'commentRangeEnd' ||
      node.kind === 'commentReference'
    ) {
      const id = node.attributes.find(
        (entry) => entry.localName === 'id' && entry.namespaceUri === WML_NAMESPACE_URI
      );
      if (id?.value === commentId) found.push(node.id);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

export function markersFor(part: OoxmlPart, commentId: string): string[] {
  return markersUnder(part.root, commentId);
}

export function commentIds(pkg: OoxmlPackage, storyPartName: string): string[] {
  const part = pkg.parts.get(commentPartNameOf(pkg, storyPartName));
  return part ? commentsOfPart(part).map((comment) => comment.id) : [];
}

export const markedComment = (word: string, id = '1'): string =>
  `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t xml:space="preserve">${word}</w:t></w:r>` +
  `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;

function load(bytes: Uint8Array): OoxmlPackage {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

/** Compact comment package. Extra stories/parts stay optional so tests do not clone ZIP boilerplate. */
export function loadCommentFixture(spec: {
  readonly body: string;
  readonly comments: string;
  readonly extended?: string;
  /** Where a present commentsExtended part is related from. Default is the story. */
  readonly extendedFrom?: 'story' | 'comments';
  /** Override content type. Word often authors the transitional `vnd.ms-word` spelling. */
  readonly extendedContentType?: string;
  readonly header?: string;
  readonly commentsIds?: string;
}): OoxmlPackage {
  const types = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
    `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>`,
  ];
  const rels = [`<Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/>`];
  const files: Record<string, Uint8Array> = {
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${spec.body}</w:body></w:document>`
    ),
    'word/comments.xml': strToU8(spec.comments),
  };
  if (spec.header !== undefined) {
    types.push(`<Override PartName="/word/header1.xml" ContentType="${HEADER_CT}"/>`);
    rels.push(`<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>`);
    files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${spec.header}</w:hdr>`);
  }
  if (spec.extended !== undefined) {
    types.push(
      `<Override PartName="/word/commentsExtended.xml" ContentType="${spec.extendedContentType ?? EXTENDED_CT}"/>`
    );
    files['word/commentsExtended.xml'] = strToU8(spec.extended);
    if (spec.extendedFrom === 'comments') {
      files['word/_rels/comments.xml.rels'] = strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId6" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>` +
          `</Relationships>`
      );
    } else {
      rels.push(`<Relationship Id="rId6" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>`);
    }
  }
  if (spec.commentsIds !== undefined) {
    types.push(`<Override PartName="/word/commentsIds.xml" ContentType="${IDS_CT}"/>`);
    rels.push(`<Relationship Id="rId7" Type="${IDS_REL}" Target="commentsIds.xml"/>`);
    files['word/commentsIds.xml'] = strToU8(spec.commentsIds);
  }
  files['[Content_Types].xml'] = strToU8(`<Types xmlns="${CT}">${types.join('')}</Types>`);
  files['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
  );
  return load(zipSync(files));
}

export function loadUniqueBodyComment(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` +
          `</Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${markedComment('body')}</w:body></w:document>`
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Ada"><w:p><w:r><w:t>only</w:t></w:r></w:p></w:comment></w:comments>`
      ),
    })
  );
}

export function loadDuplicateBodyHeader(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/header1.xml" ContentType="${HEADER_CT}"/>` +
          `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` +
          `</Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/>` +
          `</Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${markedComment('body')}</w:body></w:document>`
      ),
      'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${markedComment('header')}</w:hdr>`),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Ada"><w:p><w:r><w:t>shared</w:t></w:r></w:p></w:comment></w:comments>`
      ),
    })
  );
}

export function loadDuplicateNotes(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` +
          `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` +
          `</Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId4" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/>` +
          `</Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p/></w:body></w:document>`
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>` +
          `<w:footnote w:id="1">${markedComment('one')}</w:footnote>` +
          `<w:footnote w:id="2">${markedComment('two')}</w:footnote>` +
          `</w:footnotes>`
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Ada"><w:p><w:r><w:t>shared</w:t></w:r></w:p></w:comment></w:comments>`
      ),
    })
  );
}

const commentRecord = (id: string, paraId: string, text: string): string =>
  `<w:comment w:id="${id}" w:author="Ada"><w:p w14:paraId="${paraId}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;

/** Body and header each have their own comments + extended + ids parts, same w:id and paraId. */
export function loadIsolatedStoryComments(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/header1.xml" ContentType="${HEADER_CT}"/>` +
          `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` +
          `<Override PartName="/word/comments-hf.xml" ContentType="${COMMENTS_CT}"/>` +
          `<Override PartName="/word/commentsExtended.xml" ContentType="${EXTENDED_CT}"/>` +
          `<Override PartName="/word/commentsExtended-hf.xml" ContentType="${EXTENDED_CT}"/>` +
          `<Override PartName="/word/commentsIds.xml" ContentType="${IDS_CT}"/>` +
          `<Override PartName="/word/commentsIds-hf.xml" ContentType="${IDS_CT}"/>` +
          `</Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/>` +
          `<Relationship Id="rId6" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>` +
          `<Relationship Id="rId7" Type="${IDS_REL}" Target="commentsIds.xml"/>` +
          `</Relationships>`
      ),
      'word/_rels/header1.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId5" Type="${R}/comments" Target="comments-hf.xml"/>` +
          `<Relationship Id="rId6" Type="${EXTENDED_REL}" Target="commentsExtended-hf.xml"/>` +
          `<Relationship Id="rId7" Type="${IDS_REL}" Target="commentsIds-hf.xml"/>` +
          `</Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}"><w:body>${markedComment('body')}</w:body></w:document>`
      ),
      'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${markedComment('header')}</w:hdr>`),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${commentRecord('1', 'AAAAAAAA', 'body-rec')}</w:comments>`
      ),
      'word/comments-hf.xml': strToU8(
        `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${commentRecord('1', 'AAAAAAAA', 'header-rec')}</w:comments>`
      ),
      'word/commentsExtended.xml': strToU8(
        `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="AAAAAAAA" w15:done="0"/></w15:commentsEx>`
      ),
      'word/commentsExtended-hf.xml': strToU8(
        `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="AAAAAAAA" w15:done="1"/></w15:commentsEx>`
      ),
      'word/commentsIds.xml': strToU8(
        `<w16cid:commentsIds xmlns:w16cid="${W16CID}"><w16cid:commentId w16cid:paraId="AAAAAAAA" w16cid:durableId="11111111"/></w16cid:commentsIds>`
      ),
      'word/commentsIds-hf.xml': strToU8(
        `<w16cid:commentsIds xmlns:w16cid="${W16CID}"><w16cid:commentId w16cid:paraId="AAAAAAAA" w16cid:durableId="22222222"/></w16cid:commentsIds>`
      ),
    })
  );
}

/** Real comments live at comments2.xml; conventional comments.xml is the wrong type. */
export function loadWrongTypedConventionalComments(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/comments2.xml" ContentType="${COMMENTS_CT}"/>` +
          `<Override PartName="/word/comments.xml" ContentType="${HEADER_CT}"/>` +
          `</Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId5" Type="${R}/comments" Target="comments2.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${markedComment('body')}</w:body></w:document>`
      ),
      'word/comments2.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Ada"><w:p><w:r><w:t>real</w:t></w:r></w:p></w:comment></w:comments>`
      ),
      'word/comments.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>decoy</w:t></w:r></w:p></w:hdr>`
      ),
    })
  );
}

export function prependXmlPadding(pkg: OoxmlPackage, count: number): OoxmlPackage {
  const parts = new Map<string, OoxmlPart>();
  for (let i = 0; i < count; i += 1) {
    const name = `/word/_pad${String(i)}.xml`;
    const read = readOoxmlPart(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>pad</w:t></w:r></w:p></w:hdr>`,
      {
        name,
        contentType: HEADER_CT,
      }
    );
    if (!read.ok) throw new Error(read.reason);
    parts.set(name, read.part);
  }
  for (const [name, part] of pkg.parts) parts.set(name, part);
  return { ...pkg, parts };
}

export function keyedLocalNames(part: OoxmlPart | undefined): string[] {
  if (!part) return [];
  const names: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'commentEx' || node.localName === 'commentId')
      names.push(node.localName);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return names;
}

/** Root, a reply, and a nested reply — both parentId and paraIdParent name the chain. */
export function loadNestedReplyComments(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` +
          `<Override PartName="/word/commentsExtended.xml" ContentType="${EXTENDED_CT}"/>` +
          `<Override PartName="/word/commentsIds.xml" ContentType="${IDS_CT}"/>` +
          `</Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/>` +
          `<Relationship Id="rId6" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>` +
          `<Relationship Id="rId7" Type="${IDS_REL}" Target="commentsIds.xml"/>` +
          `</Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `${markedComment('root')}${markedComment('reply', '2')}</w:body></w:document>`
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:w16cid="${W16CID}">` +
          `${commentRecord('1', '11111111', 'root')}` +
          `<w:comment w:id="2" w:author="Ada" w16cid:parentId="1">` +
          `<w:p w14:paraId="22222222"><w:r><w:t>reply</w:t></w:r></w:p></w:comment>` +
          `<w:comment w:id="4" w:author="Ada" w16cid:parentId="2">` +
          `<w:p w14:paraId="44444444"><w:r><w:t>nested</w:t></w:r></w:p></w:comment>` +
          `</w:comments>`
      ),
      'word/commentsExtended.xml': strToU8(
        `<w15:commentsEx xmlns:w15="${W15}">` +
          `<w15:commentEx w15:paraId="11111111"/>` +
          `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111"/>` +
          `<w15:commentEx w15:paraId="44444444" w15:paraIdParent="22222222"/>` +
          `</w15:commentsEx>`
      ),
      'word/commentsIds.xml': strToU8(
        `<w16cid:commentsIds xmlns:w16cid="${W16CID}">` +
          `<w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="11111111"/>` +
          `<w16cid:commentId w16cid:paraId="22222222" w16cid:durableId="22222222"/>` +
          `<w16cid:commentId w16cid:paraId="44444444" w16cid:durableId="44444444"/>` +
          `</w16cid:commentsIds>`
      ),
    })
  );
}

/** Nested reply thread whose body and header both mark the same shared comments part. */
export function loadSharedNestedReplyComments(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/header1.xml" ContentType="${HEADER_CT}"/>` +
          `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>` +
          `<Override PartName="/word/commentsExtended.xml" ContentType="${EXTENDED_CT}"/>` +
          `<Override PartName="/word/commentsIds.xml" ContentType="${IDS_CT}"/>` +
          `</Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rId5" Type="${R}/comments" Target="comments.xml"/>` +
          `<Relationship Id="rId6" Type="${EXTENDED_REL}" Target="commentsExtended.xml"/>` +
          `<Relationship Id="rId7" Type="${IDS_REL}" Target="commentsIds.xml"/>` +
          `</Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `${markedComment('root')}${markedComment('reply', '2')}</w:body></w:document>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}">${markedComment('hdr-root')}${markedComment('hdr-reply', '2')}</w:hdr>`
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}" xmlns:w14="${W14}" xmlns:w16cid="${W16CID}">` +
          `${commentRecord('1', '11111111', 'root')}` +
          `<w:comment w:id="2" w:author="Ada" w16cid:parentId="1">` +
          `<w:p w14:paraId="22222222"><w:r><w:t>reply</w:t></w:r></w:p></w:comment>` +
          `<w:comment w:id="4" w:author="Ada" w16cid:parentId="2">` +
          `<w:p w14:paraId="44444444"><w:r><w:t>nested</w:t></w:r></w:p></w:comment>` +
          `</w:comments>`
      ),
      'word/commentsExtended.xml': strToU8(
        `<w15:commentsEx xmlns:w15="${W15}">` +
          `<w15:commentEx w15:paraId="11111111"/>` +
          `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111"/>` +
          `<w15:commentEx w15:paraId="44444444" w15:paraIdParent="22222222"/>` +
          `</w15:commentsEx>`
      ),
      'word/commentsIds.xml': strToU8(
        `<w16cid:commentsIds xmlns:w16cid="${W16CID}">` +
          `<w16cid:commentId w16cid:paraId="11111111" w16cid:durableId="11111111"/>` +
          `<w16cid:commentId w16cid:paraId="22222222" w16cid:durableId="22222222"/>` +
          `<w16cid:commentId w16cid:paraId="44444444" w16cid:durableId="44444444"/>` +
          `</w16cid:commentsIds>`
      ),
    })
  );
}
