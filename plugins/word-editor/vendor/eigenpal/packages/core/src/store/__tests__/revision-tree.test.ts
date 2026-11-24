import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function doc(body: string): OoxmlPart {
  return parse(`<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>${body}</w:body></w:document>`);
}

function find(node: OoxmlNode, kind: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  if (node.kind === kind) return node;
  for (const child of node.children) {
    const found = find(child, kind);
    if (found) return found;
  }
  return undefined;
}

function findLocal(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  if (node.localName === localName) return node;
  for (const child of node.children) {
    const found = findLocal(child, localName);
    if (found) return found;
  }
  return undefined;
}

describe('typed revision family', () => {
  test('a content-position w:ins types as an insertion carrying its provenance', () => {
    const part = doc(
      '<w:p><w:ins w:id="4" w:author="QA" w:date="2026-03-26T11:00:00Z">' +
        '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
    );
    const ins = find(part.root, 'revisionInsert');
    expect(ins).toBeDefined();
    expect(ins?.localName).toBe('ins');
    // The nested run stays a typed run — this is the whole point, since layout walks runs.
    expect(ins?.children.some((child) => child.kind === 'run')).toBe(true);
  });

  test('a content-position w:del types as a deletion and its w:delText types too', () => {
    const part = doc(
      '<w:p><w:del w:id="5" w:author="QA"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>'
    );
    expect(find(part.root, 'revisionDelete')).toBeDefined();
    const deleted = find(part.root, 'deletedText');
    expect(deleted).toBeDefined();
    expect(deleted?.children[0]).toMatchObject({ kind: 'textValue', value: 'gone' });
  });

  test('a w:ins wrapping a w:fldSimple stays a revision', () => {
    // `w:fldSimple` is a member of `EG_ContentRunContent`, which `CT_RunTrackChange` admits, and
    // it is how Word writes an inserted cross-reference. Omitting it from the allowed children
    // demoted the WRAPPER rather than the field: the insertion stopped being a revision at all,
    // so it disappeared from the page and from the review surface together.
    const part = doc(
      '<w:p><w:ins w:id="8" w:author="QA" w:date="2026-03-26T11:00:00Z">' +
        '<w:fldSimple w:instr=" REF _Ref1 \\h "><w:r><w:t>Section 3</w:t></w:r></w:fldSimple>' +
        '</w:ins></w:p>'
    );
    const ins = find(part.root, 'revisionInsert');
    expect(ins).toBeDefined();
    expect(ins?.children.some((child) => child.kind === 'fldSimple')).toBe(true);
  });

  test('w:moveFrom and w:moveTo type distinctly from a delete/insert pair', () => {
    const part = doc(
      '<w:p>' +
        '<w:moveFrom w:id="6" w:author="QA"><w:r><w:delText>x</w:delText></w:r></w:moveFrom>' +
        '<w:moveTo w:id="7" w:author="QA"><w:r><w:t>x</w:t></w:r></w:moveTo>' +
        '</w:p>'
    );
    expect(find(part.root, 'revisionMoveFrom')).toBeDefined();
    expect(find(part.root, 'revisionMoveTo')).toBeDefined();
  });

  test('a paragraph-mark revision stays generic inside w:pPr/w:rPr', () => {
    // `w:pPr/w:rPr/w:ins` marks the paragraph MARK, not content. Typing it as a content
    // revision would put a wrapper with no content into the flow.
    const part = doc(
      '<w:p><w:pPr><w:rPr><w:ins w:id="8" w:author="QA"/></w:rPr></w:pPr>' +
        '<w:r><w:t>text</w:t></w:r></w:p>'
    );
    expect(find(part.root, 'revisionInsert')).toBeUndefined();
    const rPr = find(part.root, 'runProperties');
    expect(rPr).toBeDefined();
    // Still typed as runProperties — a paragraph-mark revision must not demote it.
    expect(rPr?.children[0]).toMatchObject({ kind: 'generic', localName: 'ins' });
  });

  test('a row revision inside w:trPr stays generic', () => {
    const part = doc(
      '<w:tbl><w:tr><w:trPr><w:del w:id="9" w:author="QA"/></w:trPr>' +
        '<w:tc><w:p/></w:tc></w:tr></w:tbl>'
    );
    expect(find(part.root, 'revisionDelete')).toBeUndefined();
    expect(findLocal(part.root, 'del')?.kind).toBe('generic');
  });

  test('an rPrChange inside a run rPr stays generic and does not demote the rPr', () => {
    const part = doc(
      '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="10" w:author="QA" w:date="2026-03-26T11:00:00Z">' +
        '<w:rPr/></w:rPrChange></w:rPr><w:t>bold now</w:t></w:r></w:p>'
    );
    expect(find(part.root, 'runProperties')).toBeDefined();
    expect(findLocal(part.root, 'rPrChange')?.kind).toBe('generic');
  });

  test('comment range markers and the reference type', () => {
    const part = doc(
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>said</w:t></w:r>' +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>'
    );
    expect(find(part.root, 'commentRangeStart')).toBeDefined();
    expect(find(part.root, 'commentRangeEnd')).toBeDefined();
    expect(find(part.root, 'commentReference')).toBeDefined();
  });

  test('the comments part types its comments', () => {
    const part = parse(
      `<w:comments xmlns:w="${WML_NAMESPACE_URI}">` +
        '<w:comment w:id="0" w:author="QA" w:initials="QA" w:date="2026-03-26T11:00:00Z">' +
        '<w:p><w:r><w:t>needs coverage</w:t></w:r></w:p></w:comment></w:comments>'
    );
    expect(find(part.root, 'comments')).toBeDefined();
    const comment = find(part.root, 'comment');
    expect(comment).toBeDefined();
    expect(comment?.children.some((child) => child.kind === 'paragraph')).toBe(true);
  });

  test('a move range end carrying no author or date still types', () => {
    const part = doc(
      '<w:p><w:moveFromRangeStart w:id="1" w:name="move1" w:author="QA" ' +
        'w:date="2026-03-26T11:00:00Z"/><w:r><w:t>x</w:t></w:r>' +
        '<w:moveFromRangeEnd w:id="1"/></w:p>'
    );
    expect(find(part.root, 'moveFromRangeStart')).toBeDefined();
    const end = find(part.root, 'moveFromRangeEnd');
    expect(end).toBeDefined();
    expect(end?.attributes.some((a) => a.localName === 'author')).toBe(false);
  });

  test('revision markup round-trips with a stable canonical fingerprint', () => {
    const xml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>` +
      '<w:p><w:ins w:id="4" w:author="QA" w:date="2026-03-26T11:00:00Z">' +
      '<w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins>' +
      '<w:del w:id="5" w:author="Dev"><w:r><w:delText>gone</w:delText></w:r></w:del>' +
      '</w:p></w:body></w:document>';
    const part = parse(xml);
    const reparsed = parse(serializeOoxmlPart(part));
    expect(canonicalOoxmlFingerprint(reparsed)).toBe(canonicalOoxmlFingerprint(part));
    expect(serializeOoxmlPart(reparsed)).toBe(serializeOoxmlPart(part));
    // Typing must not lose the deleted text or the provenance.
    expect(serializeOoxmlPart(part)).toContain('<w:delText>gone</w:delText>');
    expect(serializeOoxmlPart(part)).toContain('w:author="QA"');
  });

  test('an unmodelled revision element stays generic and preserves order', () => {
    const part = doc(
      '<w:p><w:customXmlInsRangeStart w:id="1" w:author="QA"/>' + '<w:r><w:t>x</w:t></w:r></w:p>'
    );
    const paragraph = find(part.root, 'paragraph');
    expect(paragraph?.children[0]).toMatchObject({
      kind: 'generic',
      localName: 'customXmlInsRangeStart',
    });
  });
});
