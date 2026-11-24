// A footer whose first paragraph is a right-aligned PAGE frame (`w:wrap="none"`, anchored to
// the text below it) and whose second paragraph is its text line. The frame shares that line's
// band at the right margin and adds no flow height; the text paragraph lays out as if it opened
// the footer. Other frames that wrap nothing, and the same page number wrapping text, take the
// general story frame lane; every other structure keeps the ordinary flow.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
} from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { hitTestFragments } from '../semantic-hit-test.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = WML_NAMESPACE_URI;
const WIDTH = 400;
const measurer = createFixedMeasurer(6, 14);

function read(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

// The footer style carries 6pt before and after, which the frame and its text share.
const styles = (pageNumberRun = '') =>
  read(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/>' +
      '<w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="PageNumber"><w:name w:val="page number"/>' +
      `<w:rPr>${pageNumberRun}</w:rPr></w:style></w:styles>`,
    '/word/styles.xml'
  ).root;
const settings = (flag: boolean) =>
  read(
    `<w:settings xmlns:w="${W}"><w:compat>` +
      (flag ? '<w:doNotUseHTMLParagraphAutoSpacing/>' : '') +
      '</w:compat></w:settings>',
    '/word/settings.xml'
  ).root;
const cascade = (flag = false, pageNumberRun = '') =>
  buildStyleCascadeTable(styles(pageNumberRun), undefined, settings(flag));

const frame =
  '<w:framePr w:wrap="none" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right" w:y="1"/>';
const pageRun = '<w:rPr><w:rStyle w:val="PageNumber"/></w:rPr>';
const field =
  `<w:r>${pageRun}<w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r>${pageRun}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
  `<w:r>${pageRun}<w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r>${pageRun}<w:t>1</w:t></w:r>` +
  `<w:r>${pageRun}<w:fldChar w:fldCharType="end"/></w:r>`;
const framedParagraph = `<w:p><w:pPr><w:pStyle w:val="Footer"/>${frame}${pageRun}</w:pPr>${field}</w:p>`;
const anchorText =
  '<w:r><w:t xml:space="preserve">Footer note </w:t></w:r><w:r><w:t>v2</w:t></w:r>' +
  '<w:r><w:tab/></w:r><w:r><w:tab/></w:r>';
const anchorParagraph = `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:ind w:right="360"/></w:pPr>${anchorText}</w:p>`;
const body = framedParagraph + anchorParagraph;

function footerOf(content: string, root = 'ftr') {
  const kind = root === 'ftr' ? 'footer' : 'header';
  return read(`<w:${root} xmlns:w="${W}">${content}</w:${root}>`, `/word/${kind}1.xml`);
}

const lay = (content: string, styleCascade = cascade(), root = 'ftr') =>
  layoutHeaderFooterStory(
    footerOf(content, root),
    WIDTH,
    measurer,
    'right-frame',
    undefined,
    styleCascade
  );

function paragraphs(story: ReturnType<typeof layoutHeaderFooterStory>) {
  const [framed, anchor] = story.fragments;
  if (framed?.kind !== 'paragraph' || anchor?.kind !== 'paragraph')
    throw new Error('paragraphs required');
  return { framed, anchor };
}

function inkRight(fragment: ParagraphFragmentRecord): number {
  const spans = fragment.lines[0]!.spans.filter((span) => span.text.trim() !== '');
  const last = spans.at(-1)!;
  return last.box.x + last.box.width;
}

function documentOf(story: ReturnType<typeof layoutHeaderFooterStory>): SemanticLayout {
  return {
    revision: 0,
    pages: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 544, height: 792 },
        contentBox: { x: 72, y: 72, width: WIDTH, height: 648 },
        fragments: [],
        footer: {
          kind: 'footer',
          variant: 'default',
          partName: story.partName,
          part: story.part,
          box: { x: 72, y: 730, width: WIDTH, height: story.flowHeight },
          fragments: story.fragments,
        },
      },
    ],
  } as SemanticLayout;
}

describe('a right-aligned PAGE frame over the footer text', () => {
  for (const flag of [false, true]) {
    const mode = flag ? 'summed' : 'collapsed';
    test(`shares the text line and adds no flow height (${mode} spacing)`, () => {
      const styleCascade = cascade(flag);
      const part = footerOf(body);
      const before = serializeOoxmlPart(part);
      const story = layoutHeaderFooterStory(
        part,
        WIDTH,
        measurer,
        'right-frame',
        undefined,
        styleCascade
      );
      const { framed, anchor } = paragraphs(story);
      // The text paragraph lays out exactly as it does when it is the only paragraph.
      const alone = lay(anchorParagraph, styleCascade).fragments[0] as ParagraphFragmentRecord;
      expect(anchor.box).toEqual(alone.box);
      expect(anchor.spacing).toEqual(alone.spacing);
      expect(anchor.lines[0]!.box.y).toBe(alone.lines[0]!.box.y);
      expect(anchor.lines[0]!.spans.map((span) => span.box.x)).toEqual(
        alone.lines[0]!.spans.map((span) => span.box.x)
      );
      // The frame starts 1 twip below the text paragraph's top and ends at the right margin.
      expect(anchor.spacing.before).toBe(6);
      expect(framed.box.y).toBeCloseTo(0.05, 6);
      expect(framed.lines[0]!.box.y - anchor.lines[0]!.box.y).toBeCloseTo(0.05, 6);
      expect(inkRight(framed)).toBeCloseTo(WIDTH, 6);
      expect(story.flowHeight).toBeCloseTo(
        Math.max(framed.box.y + framed.box.height, anchor.box.y + anchor.box.height),
        6
      );
      expect(story.flowHeight).toBeLessThan(alone.box.height + 1);
      // Two addressable paragraphs; the source is untouched.
      expect(framed.paragraphId).not.toBe(anchor.paragraphId);
      expect(story.part).toBe(part);
      expect(serializeOoxmlPart(part)).toBe(before);
    });
  }

  test('right-aligns each page value and keeps the footer height', () => {
    const story = lay(body);
    for (const pageNumber of [1, 12, 123]) {
      const projected = story.withPageContext({
        pageNumber,
        pageCount: 200,
        sectionPageCount: 200,
      });
      const { framed, anchor } = paragraphs(projected);
      const text = framed.lines[0]!.spans.map((span) => span.text).join('');
      expect(text).toBe(String(pageNumber));
      expect(inkRight(framed)).toBeCloseTo(WIDTH, 6);
      expect(framed.box.x + framed.box.width).toBeCloseTo(WIDTH, 6);
      expect(anchor.box.y).toBe(0);
      expect(projected.flowHeight).toBeCloseTo(story.flowHeight, 6);
    }
  });

  test('a larger page-number face sets the footer height from the frame', () => {
    const story = lay(body, cascade(false, '<w:sz w:val="40"/>'));
    const { framed, anchor } = paragraphs(story);
    const plain = paragraphs(lay(body));
    expect(framed.lines[0]!.box.height).toBeGreaterThan(anchor.lines[0]!.box.height);
    expect(anchor.box).toEqual(plain.anchor.box);
    expect(framed.box.y).toBeCloseTo(0.05, 6);
    expect(inkRight(framed)).toBeCloseTo(WIDTH, 6);
    expect(story.flowHeight).toBeCloseTo(framed.box.y + framed.box.height, 6);
  });

  test('accepts the switches the page-field projection evaluates', () => {
    const plain = paragraphs(lay(body));
    for (const instruction of [' PAGE \\* MERGEFORMAT ', ' PAGE \\# "0" ']) {
      const { framed, anchor } = paragraphs(lay(body.replace(' PAGE ', instruction)));
      expect(framed.box).toEqual(plain.framed.box);
      expect(anchor.box.y).toBe(0);
    }
  });

  test('the frame box is its ink, so clicks beside it reach the text paragraph', () => {
    const story = lay(body).withPageContext({
      pageNumber: 12,
      pageCount: 20,
      sectionPageCount: 20,
    });
    const { framed, anchor } = paragraphs(story);
    const model = documentOf(story);
    const y = framed.lines[0]!.box.y + 1;
    const onNumber = hitTestFragments(model, 0, story.fragments, {
      x: framed.box.x + framed.box.width / 2,
      y,
    });
    expect(onNumber?.position.paragraphId).toBe(framed.paragraphId);
    // Inside the text paragraph's measure, which ends at its right indent, left of the number.
    const measureEnd = anchor.box.x + anchor.box.width;
    expect(measureEnd).toBeLessThan(framed.box.x);
    for (const x of [2, 150, measureEnd - 1]) {
      const beside = hitTestFragments(model, 0, story.fragments, { x, y });
      expect(beside?.position.paragraphId).toBe(anchor.paragraphId);
    }
  });
});

describe('structures that keep the ordinary flow', () => {
  const inFlow = (content: string, root = 'ftr') => {
    const story = lay(content, cascade(), root);
    return (story.fragments[1] as ParagraphFragmentRecord).box.y > 0;
  };
  const samples: [string, string][] = [
    ['wrap notBeside', body.replace('w:wrap="none"', 'w:wrap="notBeside"')],
    ['page-anchored', body.replace('w:vAnchor="text"', 'w:vAnchor="page"')],
    ['two frames', body.replace(frame, frame + frame)],
  ];
  for (const [label, content] of samples) {
    test(label, () => {
      expect(content).not.toBe(body);
      expect(inFlow(content)).toBe(true);
    });
  }

  // Other frames that wrap nothing, and a page number that wraps text, leave this lane for the
  // general story frame lane, which also keeps them out of the footer's flow.
  const placedElsewhere: [string, string][] = [
    ['wrap around', body.replace('w:wrap="none"', 'w:wrap="around"')],
    ['centered', body.replace('w:xAlign="right"', 'w:xAlign="center"')],
    ['page-relative', body.replace('w:hAnchor="margin"', 'w:hAnchor="page"')],
    ['a real offset', body.replace('w:y="1"', 'w:y="200"')],
    ['a frame width', body.replace('w:y="1"', 'w:y="1" w:w="600"')],
    ['a frame distance', body.replace('w:y="1"', 'w:y="1" w:hSpace="180"')],
    ['NUMPAGES', body.replace(' PAGE ', ' NUMPAGES ')],
    ['text in the frame', body.replace('<w:t>1</w:t>', '<w:t>Page 1</w:t>')],
    ['frame alignment', body.replace(frame, frame + '<w:jc w:val="right"/>')],
    [
      'direct spacing',
      body.replace('<w:ind w:right="360"/>', '<w:ind w:right="360"/><w:spacing w:before="0"/>'),
    ],
    [
      'another style',
      body.replace('<w:pStyle w:val="Footer"/><w:ind', '<w:pStyle w:val="Normal"/><w:ind'),
    ],
    ['an empty anchor', framedParagraph + '<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p>'],
    [
      'a tab-only anchor',
      framedParagraph + '<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:tab/></w:r></w:p>',
    ],
    ['a field in the anchor', framedParagraph + anchorParagraph.replace(anchorText, field)],
    ['a third paragraph', body + anchorParagraph],
  ];
  for (const [label, content] of placedElsewhere) {
    test(label, () => {
      expect(content).not.toBe(body);
      expect(inFlow(content)).toBe(false);
      expect(paragraphs(lay(content)).framed.outOfFlow).toBe(true);
    });
  }

  test('text that reaches under the frame', () => {
    // One unbroken line whose ink ends right of the number's left edge.
    const long = `<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>${'x'.repeat(91)}</w:t></w:r></w:p>`;
    const alone = lay(long).fragments[0] as ParagraphFragmentRecord;
    const framedAlone = paragraphs(lay(body)).framed;
    expect(alone.lines).toHaveLength(1);
    expect(inkRight(alone)).toBeGreaterThan(framedAlone.box.x);
    expect(inFlow(framedParagraph + long)).toBe(true);
  });

  test('a header, which the header frame lane places instead', () => {
    const story = lay(body, cascade(), 'hdr');
    const { framed, anchor } = paragraphs(story);
    // The footer lane shares the text paragraph's top spacing; the header lane keeps the
    // anchor exactly where it lays out alone, and the frame from that paragraph's top.
    expect(anchor.box.y).toBe(0);
    expect(framed.box.y).toBeCloseTo(0.05, 6);
    expect(inkRight(framed)).toBeCloseTo(WIDTH, 6);
  });
});
