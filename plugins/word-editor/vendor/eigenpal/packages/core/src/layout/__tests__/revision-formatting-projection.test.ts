import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../revision-projection.ts';
import { storyBlocks } from '../story-roots.ts';
import { projectRevisionFormatting } from '../revision-formatting-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const run =
  '<w:r><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="FF0000"/>' +
  '<w:rPrChange w:id="1" w:author="Ada"><w:rPr><w:i/><w:sz w:val="20"/>' +
  '<w:color w:val="0000FF"/></w:rPr></w:rPrChange></w:rPr><w:t>Example</w:t></w:r>';
const properties =
  '<w:pPr><w:jc w:val="right"/><w:ind w:left="1440"/>' +
  '<w:pPrChange w:id="2" w:author="Ada"><w:pPr><w:jc w:val="center"/>' +
  '<w:spacing w:before="240"/></w:pPr></w:pPrChange></w:pPr>';

function load(body: string, root = 'document'): OoxmlPart {
  const content = root === 'document' ? `<w:body>${body}</w:body>` : body;
  const result = readOoxmlPart(`<w:${root} xmlns:w="${W}">${content}</w:${root}>`, {
    name: root === 'document' ? '/word/document.xml' : '/word/header1.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function visible(
  part: OoxmlPart,
  mode: RevisionDisplayMode,
  revisionAuthorFilter?: RevisionAuthorFilter
) {
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    displayMode: mode,
    revisionAuthorFilter,
  });
  return linesOf(layout).map((line) => ({
    box: line.box,
    spans: line.spans.map((span) => ({ text: span.text, style: span.style, box: span.box })),
  }));
}

function resolved(part: OoxmlPart, action: 'accept' | 'reject'): OoxmlPart {
  const result = applyTreeOp(part, {
    op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('Original view restores recorded formatting', () => {
  test('preserves unchanged siblings around a changed run and keeps view caches separate', () => {
    const part = load(
      '<w:p><w:r><w:t>Before</w:t><w:tab/></w:r>' + run + '<w:r><w:t>After</w:t></w:r></w:p>'
    );
    const body = part.root.children[0]!;
    if (body.kind === 'textValue') throw new Error('expected body');
    const paragraph = body.children[0]!;
    if (paragraph.kind === 'textValue') throw new Error('expected paragraph');
    const original = projectRevisionFormatting(paragraph, 'original');
    const proposed = projectRevisionFormatting(paragraph, 'proposed');
    for (const projected of [original, proposed]) {
      expect(projected.children).toHaveLength(3);
      expect(projected.children[0]).toBe(paragraph.children[0]);
      expect(projected.children[2]).toBe(paragraph.children[2]);
      expect(projected.children[1]).not.toBe(paragraph.children[1]);
    }
    expect(original).not.toBe(proposed);
    expect(projectRevisionFormatting(paragraph, 'original')).toBe(original);
    expect(projectRevisionFormatting(paragraph, 'proposed')).toBe(proposed);
    expect(projectRevisionFormatting(paragraph, 'all-markup')).toBe(paragraph);
  });

  for (const [name, body] of [
    ['body', `<w:p>${properties}${run}</w:p>`],
    [
      'table cell',
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p>${properties}${run}</w:p></w:tc></w:tr></w:tbl>`,
    ],
    [
      'content control',
      `<w:sdt><w:sdtPr/><w:sdtContent><w:p>${properties}${run}</w:p></w:sdtContent></w:sdt>`,
    ],
  ]) {
    test(`${name}: old run and paragraph styles match rejecting the changes`, () => {
      const part = load(body!);
      const fingerprint = canonicalOoxmlFingerprint(part);
      expect(visible(part, 'original')).toEqual(visible(resolved(part, 'reject'), 'all-markup'));
      expect(visible(part, 'proposed')).toEqual(visible(resolved(part, 'accept'), 'all-markup'));
      expect(visible(part, 'original')).not.toEqual(visible(part, 'proposed'));
      expect(visible(part, 'all-markup')).toEqual(visible(part, 'proposed'));
      expect(canonicalOoxmlFingerprint(part)).toEqual(fingerprint);
    });
  }

  test('empty recorded properties remove current bold and hidden formatting', () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:b/><w:vanish/>' +
        '<w:rPrChange w:id="3" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr>' +
        '<w:t>Visible before</w:t></w:r></w:p>'
    );
    expect(visible(part, 'original')).toEqual(visible(resolved(part, 'reject'), 'all-markup'));
    expect(
      visible(part, 'original')
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('')
    ).toBe('Visible before');
    expect(visible(part, 'proposed').flatMap((line) => line.spans)).toHaveLength(0);
  });

  test('paragraph and mark formatting preserve independent mark insertion and section properties', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:ins w:id="4" w:author="Ada"/>' +
        '<w:sz w:val="40"/><w:rPrChange w:id="5" w:author="Ada"><w:rPr><w:sz w:val="20"/>' +
        '</w:rPr></w:rPrChange></w:rPr><w:sectPr><w:pgSz w:w="8391" w:h="11906"/></w:sectPr>' +
        '<w:pPrChange w:id="6" w:author="Ada"><w:pPr/></w:pPrChange></w:pPr>' +
        '<w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>'
    );
    expect(visible(part, 'original')).toEqual(visible(resolved(part, 'reject'), 'all-markup'));
    expect(storyBlocks(part, 'original')).toHaveLength(1);
  });

  test('header stories use the same projection and preserve cached block identity', () => {
    const part = load(`<w:p>${properties}${run}</w:p>`, 'hdr');
    const original = storyBlocks(part, 'original');
    expect(original).toBe(storyBlocks(part, 'original'));
    expect(visible(part, 'original')).toEqual(visible(resolved(part, 'reject'), 'all-markup'));
  });

  test('paragraph formatting preserves section geometry and restores empty-line mark size', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="right"/><w:rPr><w:sz w:val="80"/>' +
        '<w:rPrChange w:id="7" w:author="Ada"><w:rPr><w:sz w:val="20"/></w:rPr>' +
        '</w:rPrChange></w:rPr><w:sectPr><w:pgSz w:w="8391" w:h="11906"/></w:sectPr>' +
        '<w:pPrChange w:id="8" w:author="Ada"><w:pPr/></w:pPrChange></w:pPr></w:p>' +
        '<w:p><w:r><w:t>Next section</w:t></w:r></w:p>'
    );
    const original = layoutSemanticDocument(part, 1, { measurer, displayMode: 'original' });
    const rejected = layoutSemanticDocument(resolved(part, 'reject'), 1, { measurer });
    expect(original.pages.map((page) => page.box)).toEqual(rejected.pages.map((page) => page.box));
    expect(visible(part, 'original')).toEqual(visible(resolved(part, 'reject'), 'all-markup'));
    expect(visible(part, 'original')).not.toEqual(visible(part, 'proposed'));
  });

  test('hidden authors keep accepted formatting while included authors show their original formatting', () => {
    const part = load(`<w:p>${run}</w:p>`);
    const filter: RevisionAuthorFilter = { hiddenAuthors: new Set(['Ada']), cacheKey: 'hide-Ada' };
    expect(visible(part, 'original', filter)).toEqual(visible(part, 'proposed'));
    const rejected: RevisionAuthorFilter = {
      ...filter,
      cacheKey: 'reject-Ada',
      excludedNodeMode: () => 'original',
    };
    expect(visible(part, 'all-markup', rejected)).toEqual(visible(part, 'original'));
  });

  test('formatting filters apply to the revision kind as well as author visibility', () => {
    const part = load(`<w:p>${run}</w:p>`);
    const filter: RevisionAuthorFilter = {
      hiddenAuthors: new Set(),
      includes: (revision) => revision.kind !== 'format',
      cacheKey: 'hide-format',
    };
    expect(visible(part, 'original', filter)).toEqual(visible(part, 'proposed'));
  });
});
