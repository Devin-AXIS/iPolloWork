// Navigation Find ordering and scope metadata across addressable Word stories.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { MAX_NOTES_PER_PART, resolvableNotesOf } from '../../store/package/note-nodes.ts';
import { paragraphTextOf } from '../../store/store/tree-op-apply.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  expandSelectableTextboxStories,
  type SearchStory,
  type TextboxStoryExpansionWork,
} from '../document-search-frames.ts';
import { textboxStoriesInPart } from '../../store/package/textbox-stories.ts';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function textbox(text: string, story = p(text)): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="1" name="Search box"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${story}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

function fixture(): Uint8Array {
  const section =
    '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
    '<w:footerReference w:type="default" r:id="rFooter"/></w:sectPr>';
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" ` +
    `xmlns:a="${A}" xmlns:wps="${WPS}"><w:body>` +
    p('needle body') +
    '<w:p><w:r><w:footnoteReference w:id="1"/><w:endnoteReference w:id="2"/></w:r></w:p>' +
    `<w:p><w:pPr>${section}</w:pPr>${textbox('needle textbox')}</w:p>` +
    section +
    '</w:body></w:document>';
  const contentTypes =
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
    '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
    '</Types>';
  const relationships =
    `<Relationships xmlns="${REL}">` +
    `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
    `<Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/>` +
    `<Relationship Id="rFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/>` +
    `<Relationship Id="rEndnotes" Type="${R}/endnotes" Target="endnotes.xml"/>` +
    '</Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(relationships),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
        p('needle header') +
        `<w:p>${textbox('needle header textbox')}</w:p></w:hdr>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${p('needle footer')}</w:ftr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        `<w:footnote w:id="-1" w:type="separator">${p('needle separator-only')}</w:footnote>` +
        `<w:footnote w:id="1">${p('needle footnote')}</w:footnote></w:footnotes>`
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}">` +
        `<w:endnote w:id="-1" w:type="separator">${p('needle separator-only')}</w:endnote>` +
        `<w:endnote w:id="2">${p('needle endnote')}</w:endnote></w:endnotes>`
    ),
  });
}

function variantFixture(titlePage: boolean, evenAndOddHeaders: boolean): Uint8Array {
  const section =
    '<w:headerReference w:type="first" r:id="rFirst"/>' +
    '<w:headerReference w:type="even" r:id="rEven"/>' +
    (titlePage ? '<w:titlePg/>' : '');
  const settings = evenAndOddHeaders ? '<w:evenAndOddHeaders/>' : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header-first.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/header-even.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${p('body')}<w:sectPr>${section}</w:sectPr></w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rFirst" Type="${R}/header" Target="header-first.xml"/>` +
        `<Relationship Id="rEven" Type="${R}/header" Target="header-even.xml"/>` +
        `<Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/>` +
        '</Relationships>'
    ),
    'word/header-first.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('variant first')}</w:hdr>`),
    'word/header-even.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('variant even')}</w:hdr>`),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`),
  });
}

function footnoteFixture(notes: string, referenceIds: readonly number[] = [1]): Uint8Array {
  const references = referenceIds.map((id) => `<w:footnoteReference w:id="${id}"/>`).join('');
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${p('body')}` +
          `<w:p><w:r>${references}</w:r></w:p></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rFootnotes" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
          `xmlns:wps="${WPS}">${notes}</w:footnotes>`
      ),
    },
    { level: 0 }
  );
}

/** A body-only package, for questions that need no furniture or notes. */
function bodyFixture(body: string): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
          `xmlns:wps="${WPS}"><w:body>${body}</w:body></w:document>`
      ),
    },
    { level: 0 }
  );
}

function twoSectionFurnitureFixture(): Uint8Array {
  const firstSection =
    '<w:headerReference w:type="default" r:id="rH1"/>' +
    '<w:footerReference w:type="default" r:id="rF1"/>';
  const secondSection =
    '<w:headerReference w:type="default" r:id="rH2"/>' +
    '<w:footerReference w:type="default" r:id="rF2"/>';
  const body =
    `<w:p><w:pPr><w:sectPr>${firstSection}</w:sectPr></w:pPr>` +
    '<w:r><w:t>section one</w:t></w:r></w:p>' +
    p('section two') +
    `<w:sectPr>${secondSection}</w:sectPr>`;
  const overrides = ['header1', 'header2', 'footer1', 'footer2']
    .map((name) => {
      const kind = name.startsWith('header') ? 'header' : 'footer';
      return (
        `<Override PartName="/word/${name}.xml" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`
      );
    })
    .join('');
  const relationships = [
    ['rH1', 'header', 'header1.xml'],
    ['rH2', 'header', 'header2.xml'],
    ['rF1', 'footer', 'footer1.xml'],
    ['rF2', 'footer', 'footer2.xml'],
  ]
    .map(
      ([id, kind, target]) => `<Relationship Id="${id}" Type="${R}/${kind}" Target="${target}"/>`
    )
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        overrides +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${relationships}</Relationships>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('story h1')}</w:hdr>`),
    'word/header2.xml': strToU8(`<w:hdr xmlns:w="${W}">${p('story h2')}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}">${p('story f1')}</w:ftr>`),
    'word/footer2.xml': strToU8(`<w:ftr xmlns:w="${W}">${p('story f2')}</w:ftr>`),
  });
}

function open(bytes: Uint8Array = fixture()): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

describe('navigation Find stories', () => {
  test('searches stories in order with scopes and deduplicated furniture parts', () => {
    const matches = open().findText('needle').matches;

    expect(matches.map((match) => match.text)).toEqual(Array(7).fill('needle'));
    expect(matches.map((match) => match.paragraphIndex)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(matches.map((match) => match.scope)).toEqual([
      undefined,
      expect.objectContaining({ kind: 'frame' }),
      { kind: 'headerFooter', rId: 'rHeader' },
      expect.objectContaining({
        kind: 'frame',
        owner: { kind: 'headerFooter', rId: 'rHeader' },
      }),
      { kind: 'headerFooter', rId: 'rFooter' },
      { kind: 'note', id: 'footnote:1' },
      { kind: 'note', id: 'endnote:2' },
    ]);
  });

  test('searches every section header before every section footer', () => {
    const matches = open(twoSectionFurnitureFixture()).findText('story').matches;

    expect(matches.map((match) => match.contextAfter.trim())).toEqual(['h1', 'h2', 'f1', 'f2']);
    expect(matches.map((match) => match.scope)).toEqual([
      { kind: 'headerFooter', rId: 'rH1' },
      { kind: 'headerFooter', rId: 'rH2' },
      { kind: 'headerFooter', rId: 'rF1' },
      { kind: 'headerFooter', rId: 'rF2' },
    ]);
  });

  test('skips separator notes', () => {
    expect(open().findText('separator-only').matches).toEqual([]);
  });

  test('searches only the first note with a duplicate id', () => {
    const notes =
      `<w:footnote w:id="1">${p('duplicate first')}</w:footnote>` +
      `<w:footnote w:id="1">${p('duplicate second')}</w:footnote>`;
    const matches = open(footnoteFixture(notes)).findText('duplicate').matches;

    expect(matches).toHaveLength(1);
    expect(matches[0]?.scope).toEqual({ kind: 'note', id: 'footnote:1' });
    expect(matches[0]?.contextAfter.trim()).toBe('first');
  });

  test('skips a nested note element', () => {
    const notes =
      `<w:footnote w:id="1">${p('outer note')}` +
      `<w:footnote w:id="2">${p('nested target')}</w:footnote></w:footnote>`;

    expect(open(footnoteFixture(notes)).findText('nested target').matches).toEqual([]);
  });

  test('searches referenced notes and skips orphan notes', () => {
    const notes =
      `<w:footnote w:id="1">${p('note target referenced')}</w:footnote>` +
      `<w:footnote w:id="2">${p('note target orphan')}</w:footnote>`;
    const matches = open(footnoteFixture(notes, [1])).findText('note target').matches;

    expect(matches).toHaveLength(1);
    expect(matches[0]?.scope).toEqual({ kind: 'note', id: 'footnote:1' });
    expect(matches[0]?.contextAfter.trim()).toBe('referenced');
  });

  test('honours the note navigation count cap', () => {
    const prefix = Array.from(
      { length: MAX_NOTES_PER_PART - 1 },
      (_, index) => `<w:footnote w:id="${index + 1}"/>`
    ).join('');
    const notes =
      prefix +
      `<w:footnote w:id="${MAX_NOTES_PER_PART}">${p('inside cap')}</w:footnote>` +
      `<w:footnote w:id="${MAX_NOTES_PER_PART + 1}">${p('outside cap')}</w:footnote>`;
    const session = open(footnoteFixture(notes, [MAX_NOTES_PER_PART, MAX_NOTES_PER_PART + 1]));

    expect(session.findText('inside cap').matches).toHaveLength(1);
    expect(session.findText('outside cap').matches).toEqual([]);
  });

  test('searches body text-box stories after body paragraphs', () => {
    const session = open();
    const [root] = textboxStoriesInPart(session.part());
    const matches = session.findText('needle').matches;
    const frame = matches[1]!;

    expect(frame.scope).toEqual({
      kind: 'frame',
      id: root?.root.id ?? '',
      drawingNodeId: root?.drawingNodeId ?? '',
      hostParagraphId: root?.hostParagraphId ?? '',
    });
    expect(frame.text).toBe('needle');
  });

  test('reports frame offsets in the shared paragraph vocabulary', () => {
    // A tab and a break each occupy one unit of paragraph text, so a frame match that
    // computed its own offsets instead of using the shared index would land short here.
    const story =
      '<w:p><w:r><w:tab/><w:br/><w:t xml:space="preserve">before needle</w:t></w:r></w:p>';
    const session = open(bodyFixture(`<w:p>${textbox('', story)}</w:p>`));
    const match = session.findText('needle').matches.find((hit) => hit.scope?.kind === 'frame');
    if (!match) throw new Error('frame match missing');
    const raw = paragraphTextOf(session.part(), match.blockId);

    expect(raw).toBe('\t\nbefore needle');
    expect(raw.slice(match.start, match.start + match.length)).toBe('needle');
  });

  test('charges thousands of notes nothing, because a note owns no selectable frame', () => {
    const count = 2_000;
    const notes = Array.from(
      { length: count },
      (_, index) => `<w:footnote w:id="${index + 1}"><w:p>${textbox('boxed')}</w:p></w:footnote>`
    ).join('');
    const parsed = readOoxmlPart(
      `<w:footnotes xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
        `xmlns:wps="${WPS}">${notes}</w:footnotes>`,
      { name: '/word/footnotes.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const stories: SearchStory[] = resolvableNotesOf(parsed.part.root).map((root, index) => ({
      part: parsed.part,
      root,
      scope: { kind: 'note', id: `footnote:${index + 1}` },
    }));
    const work: TextboxStoryExpansionWork = { indexBuilds: 0, hostLookups: 0, indexedFrames: 0 };

    expect(expandSelectableTextboxStories(stories, work)).toEqual(stories);
    expect(work).toEqual({ indexBuilds: 0, hostLookups: 0, indexedFrames: 0 });
  });

  test('indexes and expands a very large frame list without varargs', () => {
    const count = 150_000;
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${p('host')}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    const root = parsed.part.root.children.find((child) => child.kind === 'body');
    if (!root) throw new Error('body missing');
    const paragraph = root.children.find((child) => child.kind === 'paragraph');
    if (!paragraph) throw new Error('host paragraph missing');
    const frame = { root: paragraph, drawingNodeId: 'drawing', hostParagraphId: paragraph.id };
    const frames = Array(count).fill(frame) as (typeof frame)[];
    const work: TextboxStoryExpansionWork = { indexBuilds: 0, hostLookups: 0, indexedFrames: 0 };
    const stories: SearchStory[] = [{ part: parsed.part, root }];

    expect(expandSelectableTextboxStories(stories, work, () => frames)).toHaveLength(count + 1);
    expect(work).toEqual({ indexBuilds: 1, hostLookups: 1, indexedFrames: count });
  });

  test('excludes a text box owned by a footnote', () => {
    const notes =
      `<w:footnote w:id="1">${p('ordinary note')}` +
      `<w:p>${textbox('note boxed needle')}</w:p></w:footnote>`;
    const session = open(footnoteFixture(notes));

    expect(session.findText('ordinary note').matches).toHaveLength(1);
    expect(session.findText('note boxed needle').matches).toEqual([]);
  });

  test.each([
    [false, false, []],
    [true, false, ['variant first']],
    [false, true, ['variant even']],
    [true, true, ['variant first', 'variant even']],
  ] as const)(
    'searches only paintable first and even furniture for titlePage=%s evenAndOdd=%s',
    (titlePage, evenAndOddHeaders, expected) => {
      const matches = open(variantFixture(titlePage, evenAndOddHeaders)).findText(
        'variant'
      ).matches;

      expect(matches.map((match) => match.contextAfter.trim())).toEqual(
        expected.map((text) => text.slice('variant'.length).trim())
      );
      expect(matches.map((match) => match.scope)).toEqual(
        expected.map((text) => ({
          kind: 'headerFooter',
          rId: text.endsWith('first') ? 'rFirst' : 'rEven',
        }))
      );
    }
  );

  test('applies one match budget across story boundaries', () => {
    const result = open().findText('needle', { limit: 4 });

    expect(result.matches).toHaveLength(4);
    expect(result.matches.map((match) => match.scope?.kind ?? 'body')).toEqual([
      'body',
      'frame',
      'headerFooter',
      'frame',
    ]);
    expect(result.truncated).toBe(true);
  });
});
