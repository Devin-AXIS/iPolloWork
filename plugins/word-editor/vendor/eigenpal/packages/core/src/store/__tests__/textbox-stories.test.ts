// Lightweight text-box story enumeration, including ordering, block content, and walk bounds.

import { describe, expect, test } from 'bun:test';
import {
  paragraphTextOf,
  readOoxmlPart,
  storyParagraphs,
  textboxStoriesInPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { MAX_XML_DEPTH } from '../package/ooxml-drawing-rules.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function textbox(content: string, id: number): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:wrapNone/><wp:docPr id="${id}" name="Box ${id}"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

/** The same box with one anchor detail rewritten, to cover what layout refuses to paint. */
function textboxWith(content: string, id: number, from: string, to: string): string {
  const markup = textbox(content, id);
  if (!markup.includes(from)) throw new Error(`anchor markup has no ${from}`);
  return markup.replace(from, to);
}

function wrappedTextbox(content: string, id: number): string {
  const run = textbox(content, id);
  const drawing = run.slice('<w:r>'.length, -'</w:r>'.length);
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function wrapperWithInactiveTextbox(content: string, id: number): string {
  const run = textbox(content, id);
  const drawing = run.slice('<w:r>'.length, -'</w:r>'.length);
  return (
    '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:pict/></mc:Choice>' +
    `<mc:Fallback>${drawing}</mc:Fallback></mc:AlternateContent></w:r>`
  );
}

function elementNamed(
  root: OoxmlNode,
  namespaceUri: string,
  localName: string
): OoxmlElement | null {
  if (root.kind === 'textValue') return null;
  if (root.namespaceUri === namespaceUri && root.localName === localName) return root;
  for (const child of root.children) {
    const found = elementNamed(child, namespaceUri, localName);
    if (found) return found;
  }
  return null;
}

function parse(root: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(root, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function documentPart(body: string): OoxmlPart {
  return parse(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" ` +
      `xmlns:mc="${MC}">` +
      `<w:body>${body}</w:body></w:document>`
  );
}

function replaceDrawingWithDeepChain(part: OoxmlPart): OoxmlPart {
  const replace = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.kind === 'drawing') {
      let child: OoxmlNode = node;
      for (let depth = 0; depth < MAX_XML_DEPTH; depth += 1) {
        child = {
          kind: 'generic',
          id: `deep-${depth}`,
          namespaceUri: 'urn:docx-editor:test',
          localName: 'wrapper',
          namespaceBindings: [],
          attributes: [],
          children: [child],
        };
      }
      return child;
    }
    return { ...node, children: node.children.map(replace) } as OoxmlNode;
  };
  return { ...part, root: replace(part.root) as OoxmlPart['root'] };
}

describe('textboxStoriesInPart', () => {
  test('lists body roots in drawing order with their drawing and host paragraph ids', () => {
    const part = documentPart(
      `<w:p>${textbox(paragraph('first'), 1)}</w:p>` +
        paragraph('between') +
        `<w:p>${textbox(paragraph('second'), 2)}</w:p>`
    );
    const stories = textboxStoriesInPart(part);

    expect(stories).toHaveLength(2);
    expect(
      stories.map((story) => paragraphTextOf(part, storyParagraphs(story.root)[0]!.id))
    ).toEqual(['first', 'second']);
    expect(stories[0]!.drawingNodeId).not.toBe(stories[1]!.drawingNodeId);
    expect(stories[0]!.hostParagraphId).not.toBe(stories[1]!.hostParagraphId);
    expect(textboxStoriesInPart(part)).toBe(stories);
  });

  test('uses the layout atom id for a drawing inside mc:AlternateContent', () => {
    const part = documentPart(`<w:p>${wrappedTextbox(paragraph('wrapped'), 5)}</w:p>`);
    const wrapper = elementNamed(part.root, MC, 'AlternateContent');
    const drawing = elementNamed(part.root, W, 'drawing');
    const stories = textboxStoriesInPart(part);
    const [story] = stories;

    expect(stories).toHaveLength(1);
    expect(wrapper).toBeDefined();
    expect(drawing).toBeDefined();
    expect(story?.drawingNodeId).toBe(wrapper?.id);
    expect(story?.drawingNodeId).not.toBe(drawing?.id);
  });

  test('does not descend into inactive mc:AlternateContent branches', () => {
    const part = documentPart(`<w:p>${wrapperWithInactiveTextbox(paragraph('inactive'), 6)}</w:p>`);

    expect(textboxStoriesInPart(part)).toEqual([]);
  });

  test('lists a header text box and exposes table and block-control paragraphs', () => {
    const content =
      `<w:tbl><w:tr><w:tc>${paragraph('table')}` +
      `<w:tbl><w:tr><w:tc>${paragraph('nested table')}</w:tc></w:tr></w:tbl>` +
      '</w:tc></w:tr></w:tbl>' +
      `<w:sdt><w:sdtContent>${paragraph('control')}</w:sdtContent></w:sdt>`;
    const part = parse(
      `<w:hdr xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
        `<w:p>${textbox(content, 3)}</w:p></w:hdr>`,
      '/word/header1.xml'
    );
    const [story] = textboxStoriesInPart(part);

    expect(story).toBeDefined();
    expect(storyParagraphs(story!.root).map((node) => paragraphTextOf(part, node.id))).toEqual([
      'table',
      'nested table',
      'control',
    ]);
  });

  test('skips a hidden box, which layout never paints', () => {
    const hidden = textboxWith(paragraph('boxed'), 1, 'name="Box 1"', 'name="Box 1" hidden="1"');

    expect(textboxStoriesInPart(documentPart(`<w:p>${hidden}</w:p>`))).toEqual([]);
  });

  test('skips a zero-sized box, which no overlay can resolve', () => {
    const flat = textboxWith(paragraph('boxed'), 1, 'cx="914400" cy="457200"', 'cx="0" cy="0"');

    expect(textboxStoriesInPart(documentPart(`<w:p>${flat}</w:p>`))).toEqual([]);
  });

  test('stops before a drawing beyond the XML depth bound', () => {
    const part = documentPart(`<w:p>${textbox(paragraph('deep'), 4)}</w:p>`);

    expect(textboxStoriesInPart(replaceDrawingWithDeepChain(part))).toEqual([]);
  });
});

for (const depth of [31, 32])
  test(`textbox search shares the inline addressability boundary at ${depth}`, () => {
    const wrapped =
      '<w:smartTag>'.repeat(depth) + textbox(paragraph('boxed'), 1) + '</w:smartTag>'.repeat(depth);
    expect(textboxStoriesInPart(documentPart(`<w:p>${wrapped}</w:p>`))).toHaveLength(
      depth < 32 ? 1 : 0
    );
  });

describe('textboxStoriesInPart after an edit', () => {
  const bodyOf = (part: OoxmlPart): OoxmlElement => {
    const body = part.root.children.find((child) => child.kind === 'body');
    if (!body || body.kind === 'textValue') throw new Error('no body');
    return body;
  };
  const withBody = (part: OoxmlPart, children: readonly OoxmlNode[]): OoxmlPart =>
    ({
      ...part,
      root: { ...part.root, children: [{ ...bodyOf(part), children: [...children] }] },
    }) as OoxmlPart;

  test('reuses the stories of unchanged blocks and walks the new ones', () => {
    const part = documentPart(
      `<w:p>${textbox(paragraph('first'), 1)}</w:p>` +
        `<w:tbl><w:tr><w:tc><w:p>${textbox(paragraph('cell'), 2)}</w:p></w:tc></w:tr></w:tbl>` +
        paragraph('plain')
    );
    const stories = textboxStoriesInPart(part);
    const added = bodyOf(documentPart(`<w:p>${textbox(paragraph('added'), 3)}</w:p>`)).children;
    const edited = withBody(part, [...added, ...bodyOf(part).children]);
    const again = textboxStoriesInPart(edited);

    expect(stories).toHaveLength(2);
    expect(again).toHaveLength(3);
    expect(again[1]).toBe(stories[0]);
    expect(again[2]).toBe(stories[1]);
    expect(storyParagraphs(again[0]!.root).map((node) => paragraphTextOf(edited, node.id))).toEqual(
      ['added']
    );
  });

  test('walks a reused block again when the namespaces in scope change', () => {
    const part = documentPart(`<w:p>${wrappedTextbox(paragraph('wrapped'), 5)}</w:p>`);
    const root = part.root as OoxmlElement;
    const withoutWps = {
      ...part,
      root: {
        ...root,
        namespaceBindings: root.namespaceBindings.filter((binding) => binding.prefix !== 'wps'),
      },
    } as OoxmlPart;

    expect(textboxStoriesInPart(part)).toHaveLength(1);
    expect(textboxStoriesInPart(withoutWps)).toEqual([]);
  });
});
