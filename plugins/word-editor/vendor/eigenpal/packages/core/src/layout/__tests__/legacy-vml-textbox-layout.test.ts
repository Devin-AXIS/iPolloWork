// Legacy VML text boxes lay their story out inside the shape box with the `v:textbox` insets,
// floating or on the line, in the body and in a header.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  forEachSemanticSpan,
  geometryOfSection,
  layoutSemanticDocument,
  type AnchoredDrawingRecord,
  type InlineDrawingRecord,
  type SemanticLayout,
} from '../index.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import {
  readOoxmlPackage,
  readOoxmlPart,
  resolveHeaderFooterPartsBySection,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const W10 = 'urn:schemas-microsoft-com:office:word';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS = `xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:w10="${W10}" xmlns:r="${R}"`;

/** 6 pt per character, 14 pt lines. */
const measurer = createFixedMeasurer(6, 14);

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function floatingRect(content: string, inset = ''): string {
  return (
    '<w:r><w:pict><v:rect style="position:absolute;left:0;text-align:left;margin-left:36pt;' +
    'margin-top:12pt;width:120pt;height:60pt;z-index:251659264;visibility:visible" fillcolor="#ddd">' +
    `<v:textbox${inset}><w:txbxContent>${content}</w:txbxContent></v:textbox></v:rect></w:pict></w:r>`
  );
}

function inlineShape(content: string): string {
  return (
    '<w:r><w:pict><v:shape type="#_x0000_t202" style="width:120pt;height:40pt;' +
    'mso-left-percent:-10001;mso-top-percent:-10001;mso-position-horizontal:absolute;' +
    'mso-position-horizontal-relative:char;mso-position-vertical:absolute;' +
    'mso-position-vertical-relative:line" stroked="f">' +
    `<v:textbox inset="0,0,0,0"><w:txbxContent>${content}</w:txbxContent></v:textbox>` +
    '<w10:anchorlock/></v:shape></w:pict></w:r>'
  );
}

function documentPart(bodyXml: string): OoxmlPart {
  const doc = readOoxmlPart(`<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!doc.ok) throw new Error(doc.reason);
  return doc.part;
}

function drawingLayoutFor(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
}

function layoutBody(part: OoxmlPart): SemanticLayout {
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    inlineDrawingLayout: drawingLayoutFor(part),
  });
}

function storyTexts(drawing: InlineDrawingRecord | AnchoredDrawingRecord): string[] {
  return paragraphFragmentsOfBlocks(drawing.textboxStory?.fragments ?? [], true).map((fragment) =>
    fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
  );
}

function inlineDrawings(layout: SemanticLayout): InlineDrawingRecord[] {
  return paragraphFragmentsOfBlocks(layout.pages[0]!.fragments, true)
    .flatMap((fragment) => fragment.lines)
    .flatMap((line) => line.drawings ?? []);
}

describe('floating VML text box', () => {
  const BODY =
    `<w:p>${run('Host ')}${floatingRect(paragraph('First line') + paragraph('Second'))}</w:p>` +
    paragraph('Body text');

  test('lays the story out inside the box with the default insets', () => {
    const layout = layoutBody(documentPart(BODY));
    const drawings = layout.pages[0]!.anchoredDrawings ?? [];
    expect(drawings).toHaveLength(1);
    const drawing = drawings[0]!;
    expect(drawing.width).toBe(120);
    expect(drawing.height).toBe(60);
    expect(storyTexts(drawing)).toEqual(['First line', 'Second']);
    const story = drawing.textboxStory!;
    // 0.1 in left and right, 0.05 in top and bottom, plus half the 0.75 pt outline.
    expect(story.contentOffset.x).toBeCloseTo(7.2 + 0.375, 6);
    expect(story.contentOffset.y).toBeCloseTo(3.6 + 0.375, 6);
    expect(story.fillHex).toBe('DDDDDD');
  });

  test('an inset override moves the story', () => {
    const part = documentPart(
      `<w:p>${floatingRect(paragraph('Tight'), ' inset="0,0,0,0"')}</w:p>` + paragraph('Body')
    );
    const drawing = layoutBody(part).pages[0]!.anchoredDrawings![0]!;
    expect(drawing.textboxStory!.contentOffset.x).toBeCloseTo(0.375, 6);
    expect(drawing.textboxStory!.contentWidth).toBeCloseTo(120 - 0.75, 6);
  });

  test('record walks reach the story text', () => {
    const texts: string[] = [];
    forEachSemanticSpan(layoutBody(documentPart(BODY)), (visit) => {
      if (visit.textboxDepth > 0) texts.push(visit.span.text);
    });
    expect(texts.join('')).toContain('First line');
  });

  test('paints the story text inside the shape box', () => {
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutBody(documentPart(BODY)), { scale: 1 });
    const box = container.querySelector<HTMLElement>('.docx-drawing-textbox');
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain('First line');
    expect(box!.querySelector('.docx-drawing-textbox-box')?.getAttribute('style')).toContain(
      'border'
    );
  });
});

describe('unwrapped VML text box', () => {
  // The fixed measurer's 6pt advance, scaled from 11pt to the 10pt default run size.
  const CHAR = 60 / 11;
  const narrowRect = (content: string, shapeStyle: string, textboxStyle = '') =>
    '<w:r><w:pict><v:rect style="position:absolute;left:0;text-align:left;margin-left:36pt;' +
    `margin-top:12pt;width:20pt;height:30pt;z-index:251659264;${shapeStyle}" stroked="f">` +
    `<v:textbox${textboxStyle}><w:txbxContent>${content}</w:txbxContent></v:textbox></v:rect></w:pict></w:r>`;

  test('mso-wrap-style:none keeps each paragraph on one line and sizes the box', () => {
    const part = documentPart(
      `<w:p>${narrowRect(paragraph('Unwrapped label'), 'mso-wrap-style:none', ' style="mso-fit-shape-to-text:t"')}</w:p>` +
        paragraph('Body')
    );
    const drawing = layoutBody(part).pages[0]!.anchoredDrawings![0]!;
    expect(storyTexts(drawing)).toEqual(['Unwrapped label']);
    expect(drawing.textboxStory!.contentWidth).toBeCloseTo(15 * CHAR, 1);
    expect(drawing.width).toBeCloseTo(15 * CHAR + 14.4, 1);
  });

  test('an inline box keeps its extent and wraps inside it', () => {
    const shape =
      '<w:r><w:pict><v:shape type="#_x0000_t202" style="width:20pt;height:40pt;' +
      'mso-position-horizontal-relative:char;mso-position-vertical-relative:line;' +
      'mso-wrap-style:none" stroked="f">' +
      `<v:textbox inset="0,0,0,0"><w:txbxContent>${paragraph('Inline label')}</w:txbxContent>` +
      '</v:textbox><w10:anchorlock/></v:shape></w:pict></w:r>';
    const drawings = inlineDrawings(layoutBody(documentPart(`<w:p>${shape}</w:p>`)));
    expect(drawings).toHaveLength(1);
    expect(drawings[0]!.width).toBe(20);
    expect(drawings[0]!.textboxStory!.extentWidth).toBeUndefined();
    expect(drawings[0]!.textboxStory!.contentWidth).toBeCloseTo(20, 3);
  });

  test('square wrapping still breaks at the box', () => {
    const part = documentPart(
      `<w:p>${narrowRect(paragraph('Wrapped label'), 'mso-wrap-style:square')}</w:p>` +
        paragraph('Body')
    );
    const drawing = layoutBody(part).pages[0]!.anchoredDrawings![0]!;
    expect(storyTexts(drawing).join('')).toBe('Wrapped label');
    const lines = paragraphFragmentsOfBlocks(drawing.textboxStory!.fragments, true).flatMap(
      (fragment) => fragment.lines
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(drawing.width).toBe(20);
  });
});

describe('inline VML text box', () => {
  test('takes its extent on the line and lays its story out', () => {
    const part = documentPart(
      `<w:p>${run('Before ')}${inlineShape(paragraph('Inline words'))}${run(' after')}</w:p>`
    );
    const layout = layoutBody(part);
    expect(layout.pages[0]!.anchoredDrawings ?? []).toHaveLength(0);
    const drawings = inlineDrawings(layout);
    expect(drawings).toHaveLength(1);
    expect(drawings[0]!.width).toBe(120);
    expect(drawings[0]!.height).toBe(40);
    expect(storyTexts(drawings[0]!)).toEqual(['Inline words']);
    expect(drawings[0]!.textboxStory!.contentOffset).toEqual({ x: 0, y: 0 });
  });
});

describe('VML text box path flags', () => {
  const pathBox = (path: string, shapeAttrs = 'filled="f" stroked="f"') =>
    '<w:r><w:pict><v:shape type="#_x0000_t202" style="width:154pt;height:330pt;' +
    'margin-top:200pt;margin-left:36pt;mso-position-horizontal-relative:page;' +
    `mso-position-vertical-relative:page;position:absolute;z-index:251662336" ${shapeAttrs}>` +
    `${path}<v:textbox inset="0,0,0,0"><w:txbxContent>${paragraph('Side note')}` +
    `${paragraph('Second note')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`;
  const anchored = (path: string, shapeAttrs?: string) =>
    layoutBody(documentPart(`<w:p>${pathBox(path, shapeAttrs)}</w:p>` + paragraph('Body')))
      .pages[0]!.anchoredDrawings ?? [];

  test('an unstroked path with a whole-shape text rectangle lays out the story', () => {
    const drawings = anchored('<v:path strokeok="f" textboxrect="0,0,21600,21600"/>');
    expect(drawings).toHaveLength(1);
    expect(drawings[0]!.width).toBe(154);
    expect(drawings[0]!.height).toBe(330);
    expect(storyTexts(drawings[0]!)).toEqual(['Side note', 'Second note']);
    expect(drawings[0]!.textboxStory!.contentOffset).toEqual({ x: 0, y: 0 });
    expect(drawings[0]!.textboxStory!.fillHex).toBeNull();
    expect(drawings[0]!.textboxStory!.strokeHex).toBeNull();
  });

  test('strokeok off removes the outline of a stroked shape', () => {
    const stroked = anchored('<v:path gradientshapeok="t"/>', 'filled="f"')[0]!;
    expect(stroked.textboxStory!.strokeHex).toBe('000000');
    const unstroked = anchored('<v:path strokeok="f"/>', 'filled="f"')[0]!;
    expect(unstroked.textboxStory!.strokeHex).toBeNull();
    expect(storyTexts(unstroked)).toEqual(['Side note', 'Second note']);
  });

  test('the text rectangle is read in the shape coordinate space', () => {
    const drawings = anchored(
      '<v:path textboxrect="0,0,1000,1000"/>',
      'coordsize="1000,1000" filled="f" stroked="f"'
    );
    expect(storyTexts(drawings[0]!)).toEqual(['Side note', 'Second note']);
  });

  test('a text box shape ignores a text rectangle of its own', () => {
    for (const rect of ['1000,0,21600,21600', '0,0,10800,21600', '0,0,1000,1000', '0,0;0,0']) {
      const drawings = anchored(`<v:path textboxrect="${rect}"/>`);
      expect(storyTexts(drawings[0]!)).toEqual(['Side note', 'Second note']);
      expect(drawings[0]!.textboxStory!.contentOffset).toEqual({ x: 0, y: 0 });
    }
  });
});

describe('VML text box in a header', () => {
  test('the header story lays out the box story', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr ${NS}><w:p>${run('Head ')}${floatingRect(paragraph('Header box'))}</w:p></w:hdr>`
      ),
      'word/document.xml': strToU8(
        `<w:document ${NS}><w:body>${paragraph('Body')}` +
          '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>' +
          '<w:pgSz w:w="12240" w:h="15840"/>' +
          '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
          '</w:sectPr></w:body></w:document>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const pkg = loaded.package;
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const geometry = geometryOfSection(enumerateDocumentSections(part)[0]!.properties);
    const headerPart = resolveHeaderFooterPartsBySection(pkg)[0]!.headers.get('default')!;
    const header = layoutHeaderFooterStory(
      headerPart,
      geometry.width - geometry.margin.left - geometry.margin.right,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      drawingLayoutFor(headerPart)
    );
    const drawing = header.anchoredDrawings?.[0];
    expect(drawing?.textboxStory).toBeDefined();
    expect(storyTexts(drawing!)).toEqual(['Header box']);
  });
});
