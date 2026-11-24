// Paragraph borders through the protocol: `getParagraphBorders` and `setParagraphFormat.borders`.
//
// Borders cascade edge by edge. A read answers what the page shows; a write applies its
// assignments in order and states only the edges it changes.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  open,
  p,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';
import type {
  AutomationParagraphBorderAssignment,
  AutomationParagraphBordersWrite,
} from '../paragraph-borders.ts';

const RULED_STYLE =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Ruled"><w:name w:val="Ruled"/>' +
  '<w:pPr><w:pBdr><w:top w:val="double" w:sz="6" w:space="1" w:color="FF0000"/>' +
  '<w:bottom w:val="single" w:sz="12" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:style>';

const ruled = (text: string): string =>
  `<w:p><w:pPr><w:pStyle w:val="Ruled"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const OWN_RED =
  '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="FF0000"/>' +
  '</w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>';

function bordersOf(host: AutomationHost, paragraph: AutomationHandle) {
  const response = host.execute({
    operations: [{ op: 'getParagraphBorders', paragraph: { paragraph } }],
  });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'paragraphBorders')
    throw new Error(`expected borders: ${JSON.stringify(result)}`);
  return result.value.borders;
}

function write(
  host: AutomationHost,
  paragraph: AutomationHandle,
  borders: AutomationParagraphBordersWrite,
  extra: Record<string, unknown> = {}
) {
  return host.execute({
    operations: [
      { op: 'setParagraphFormat', paragraph: { paragraph }, format: { borders, ...extra } },
    ],
  });
}

/** One assignment, in the order a caller would make it. */
function a(edge: string, property: string, value: unknown): AutomationParagraphBorderAssignment {
  return { edge, property, value } as AutomationParagraphBorderAssignment;
}

function only(host: AutomationHost): AutomationHandle {
  return paragraphsOf(host, roots(host).body)[0]!;
}

const NONE = {
  isVisible: false,
  lineStyle: 'None',
  lineWidth: null,
  color: null,
  colorIndex: null,
};

describe('reading paragraph borders', () => {
  test('answers five edges in collection order, between last and inside', () => {
    const host = open(docx(p('plain')));
    const borders = bordersOf(host, only(host));
    expect(borders.map((edge) => edge.edge)).toEqual(['top', 'left', 'bottom', 'right', 'between']);
    expect(borders.map((edge) => edge.inside)).toEqual([false, false, false, false, true]);
    for (const edge of borders) expect(edge).toMatchObject(NONE);
  });

  test('reads the paragraph own border values', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:left w:val="dashed" w:sz="8" w:space="4" w:color="0000FF"/>' +
          '<w:between w:val="dotted" w:sz="16"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    const [top, left, bottom, , between] = bordersOf(host, only(host));
    expect(top).toMatchObject(NONE);
    expect(bottom).toMatchObject(NONE);
    expect(left).toMatchObject({
      isVisible: true,
      lineStyle: 'DashLargeGap',
      lineWidth: 'Pt100',
      color: '#0000FF',
      colorIndex: 'Blue',
    });
    // Two points is no `Word.LineWidth` value, and an absent colour is automatic.
    expect(between).toMatchObject({
      isVisible: true,
      lineStyle: 'Dot',
      lineWidth: null,
      color: null,
      colorIndex: 'Auto',
    });
  });

  test('reads a border the style supplies', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const [top, , bottom] = bordersOf(host, only(host));
    expect(top).toMatchObject({
      isVisible: true,
      lineStyle: 'Double',
      lineWidth: 'Pt075',
      color: '#FF0000',
      colorIndex: 'Red',
    });
    expect(bottom).toMatchObject({ isVisible: true, lineStyle: 'Single', lineWidth: 'Pt150' });
  });

  test('the paragraph own element folds over the style edge by edge', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Ruled"/><w:pBdr><w:left w:val="single"/>' +
          '<w:bottom w:val="nil"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
        RULED_STYLE
      )
    );
    const [top, left, bottom] = bordersOf(host, only(host));
    expect(top).toMatchObject({ isVisible: true, lineStyle: 'Double' });
    expect(left.isVisible).toBe(true);
    expect(bottom.isVisible).toBe(false);
  });

  test('a table style border reads in force and turns off as none', () => {
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/>' +
      '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="auto"/></w:pBdr></w:pPr>' +
      '</w:style>';
    const host = open(
      docx(
        '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
          '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        styles
      )
    );
    const cell = paragraphsOf(host, roots(host).body).find(
      (paragraph) => bordersOf(host, paragraph)[2]?.isVisible
    );
    expect(cell).toBeDefined();
    expect(bordersOf(host, cell!)[2]).toMatchObject({ lineStyle: 'Single', lineWidth: 'Pt100' });
    write(host, cell!, [a('bottom', 'isVisible', false)]);
    expect(savedMainXml(host)).toContain(
      '<w:pBdr><w:bottom w:color="auto" w:space="0" w:sz="0" w:val="none"/></w:pBdr>'
    );
    expect(bordersOf(host, cell!)[2]?.isVisible).toBe(false);
  });

  test('a line style no Office value names reads null, art and thick included', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:top w:val="thick"/><w:bottom w:val="apples" w:sz="24"/></w:pBdr>' +
          '</w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    const [top, , bottom] = bordersOf(host, only(host));
    expect(top).toMatchObject({ isVisible: true, lineStyle: null });
    expect(bottom).toMatchObject({ isVisible: true, lineStyle: null, lineWidth: 'Pt300' });
  });
});

describe('writing paragraph borders', () => {
  test('a new line is half a point, automatic, with no gap', () => {
    const host = open(docx(p('plain')));
    const paragraph = only(host);
    expect(write(host, paragraph, [a('bottom', 'lineStyle', 'Single')]).results[0]?.status).toBe(
      'ok'
    );
    expect(savedMainXml(host)).toContain(
      '<w:pBdr><w:bottom w:color="auto" w:space="0" w:sz="4" w:val="single"/></w:pBdr>'
    );
    expect(bordersOf(host, paragraph)[2]).toMatchObject({
      isVisible: true,
      lineStyle: 'Single',
      lineWidth: 'Pt050',
      colorIndex: 'Auto',
    });
  });

  test('isVisible draws the same single line on side edges', () => {
    const host = open(docx(p('plain')));
    write(host, only(host), [a('left', 'isVisible', true), a('right', 'isVisible', true)]);
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:left w:color="auto" w:space="0" w:sz="4" w:val="single"/>');
    expect(xml).toContain('<w:right w:color="auto" w:space="0" w:sz="4" w:val="single"/>');
  });

  test('every Office line style and width writes its OOXML value, and reads back', () => {
    const styles = {
      Single: 'single',
      Dot: 'dotted',
      DashSmallGap: 'dashSmallGap',
      DashLargeGap: 'dashed',
      DashDot: 'dotDash',
      DashDotDot: 'dotDotDash',
      Double: 'double',
      Triple: 'triple',
      ThinThickSmallGap: 'thinThickSmallGap',
      ThickThinSmallGap: 'thickThinSmallGap',
      ThinThickThinSmallGap: 'thinThickThinSmallGap',
      ThinThickMedGap: 'thinThickMediumGap',
      ThickThinMedGap: 'thickThinMediumGap',
      ThinThickThinMedGap: 'thinThickThinMediumGap',
      ThinThickLargeGap: 'thinThickLargeGap',
      ThickThinLargeGap: 'thickThinLargeGap',
      ThinThickThinLargeGap: 'thinThickThinLargeGap',
      SingleWavy: 'wave',
      DoubleWavy: 'doubleWave',
      DashDotStroked: 'dashDotStroked',
      Emboss3D: 'threeDEmboss',
      Engrave3D: 'threeDEngrave',
      Outset: 'outset',
      Inset: 'inset',
    } as const;
    const widths = {
      Pt025: 2,
      Pt050: 4,
      Pt075: 6,
      Pt100: 8,
      Pt150: 12,
      Pt225: 18,
      Pt300: 24,
      Pt450: 36,
      Pt600: 48,
    } as const;
    const host = open(docx(p('plain')));
    const paragraph = only(host);
    const widthNames = Object.keys(widths) as (keyof typeof widths)[];
    Object.entries(styles).forEach(([style, value], index) => {
      const width = widthNames[index % widthNames.length]!;
      const response = write(host, paragraph, [
        a('top', 'lineStyle', style),
        a('top', 'lineWidth', width),
      ]);
      expect(response.results[0]?.status).toBe('ok');
      expect(savedMainXml(host)).toContain(`w:sz="${widths[width]}" w:val="${value}"`);
      expect(bordersOf(host, paragraph)[0]).toMatchObject({ lineStyle: style, lineWidth: width });
    });
  });

  test('a line style resets the width and keeps the colour and gap', () => {
    const host = open(docx(OWN_RED));
    write(host, only(host), [a('bottom', 'lineStyle', 'Double')]);
    expect(savedMainXml(host)).toContain(
      '<w:bottom w:color="FF0000" w:space="1" w:sz="4" w:val="double"/>'
    );
  });

  test('assignments apply in order: a width before the line style is lost', () => {
    const before = open(docx(p('plain')));
    write(before, only(before), [a('top', 'lineWidth', 'Pt300'), a('top', 'lineStyle', 'Single')]);
    expect(savedMainXml(before)).toContain('w:sz="4" w:val="single"');
    const after = open(docx(p('plain')));
    write(after, only(after), [a('top', 'lineStyle', 'Single'), a('top', 'lineWidth', 'Pt300')]);
    expect(savedMainXml(after)).toContain('w:sz="24" w:val="single"');
  });

  test('a width on an edge with no line changes nothing', () => {
    const host = open(docx(p('plain')));
    const before = savedMainXml(host);
    const response = write(host, only(host), [a('top', 'lineWidth', 'Pt100')]);
    expect(response.results[0]?.status).toBe('ok');
    expect(savedMainXml(host)).toBe(before);
  });

  test('a colour on an edge with no line colours the line drawn after it', () => {
    const host = open(docx(p('plain')));
    write(host, only(host), [a('top', 'colorIndex', 'Red'), a('top', 'lineStyle', 'Single')]);
    expect(savedMainXml(host)).toContain(
      '<w:top w:color="FF0000" w:space="0" w:sz="4" w:val="single"/>'
    );
  });

  test('a later hide wins over an earlier width or colour', () => {
    const host = open(docx(OWN_RED));
    const response = write(host, only(host), [
      a('bottom', 'lineWidth', 'Pt300'),
      a('bottom', 'color', '#00FF00'),
      a('bottom', 'isVisible', false),
    ]);
    expect(response.results[0]?.status).toBe('ok');
    expect(savedMainXml(host)).not.toContain('pBdr');
  });

  test('a colour replaces a theme colour, and colorIndex writes the palette value', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:color="4472C4" w:themeColor="accent1"' +
          ' w:themeShade="BF"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    const paragraph = only(host);
    write(host, paragraph, [
      a('top', 'color', '#00ff00'),
      a('bottom', 'lineStyle', 'Single'),
      a('bottom', 'colorIndex', 'Teal'),
    ]);
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:top w:color="00FF00" w:sz="4" w:val="single"/>');
    expect(xml).toContain('<w:bottom w:color="008080" w:space="0" w:sz="4" w:val="single"/>');
    write(host, paragraph, [a('top', 'colorIndex', 'Auto')]);
    expect(bordersOf(host, paragraph)[0]).toMatchObject({ color: null, colorIndex: 'Auto' });
  });

  test('a colour the edge already stores keeps its theme colour', () => {
    const own =
      '<w:top w:color="4472C4" w:sz="4" w:themeColor="accent1" w:themeShade="BF" w:val="single"/>';
    const host = open(
      docx(`<w:p><w:pPr><w:pBdr>${own}</w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    );
    const paragraph = only(host);
    const read = bordersOf(host, paragraph)[0]!;
    write(host, paragraph, [a('top', 'color', read.color)]);
    expect(savedMainXml(host)).toContain(own);
  });

  test('an own edge with no usable line stays off over a style line', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Ruled"/><w:pBdr><w:bottom w:val="apples!" w:sz="4"/></w:pBdr>' +
          '</w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
        RULED_STYLE
      )
    );
    const paragraph = only(host);
    const response = write(host, paragraph, [a('left', 'lineStyle', 'Single')]);
    expect(response.results[0]?.status).toBe('ok');
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:bottom w:color="auto" w:space="0" w:sz="0" w:val="none"/>');
    expect(bordersOf(host, paragraph)[2]?.isVisible).toBe(false);
  });

  test('turning the only own edge off removes the paragraph border', () => {
    const host = open(docx(OWN_RED));
    write(host, only(host), [a('bottom', 'isVisible', false)]);
    expect(savedMainXml(host)).not.toContain('pBdr');
  });

  test('changing one edge of a style border states only that edge', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    write(host, paragraph, [a('bottom', 'color', '#0000FF')]);
    expect(savedMainXml(host)).toContain(
      '<w:pBdr><w:bottom w:color="0000FF" w:space="1" w:sz="12" w:val="single"/></w:pBdr>'
    );
    const [top, , bottom] = bordersOf(host, paragraph);
    expect(top).toMatchObject({ isVisible: true, lineStyle: 'Double' });
    expect(bottom).toMatchObject({ isVisible: true, color: '#0000FF' });
  });

  test('turning a style edge off writes it off as none', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    write(host, paragraph, [a('top', 'isVisible', false), a('bottom', 'lineStyle', 'None')]);
    expect(savedMainXml(host)).toContain(
      '<w:pBdr><w:top w:color="auto" w:space="0" w:sz="0" w:val="none"/>' +
        '<w:bottom w:color="auto" w:space="0" w:sz="0" w:val="none"/></w:pBdr>'
    );
    for (const edge of bordersOf(host, paragraph)) expect(edge.isVisible).toBe(false);
  });

  test('turning off an own edge with no style line under it removes it', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Ruled"/><w:pBdr><w:left w:val="single"/></w:pBdr></w:pPr>' +
          '<w:r><w:t>x</w:t></w:r></w:p>',
        RULED_STYLE
      )
    );
    const paragraph = only(host);
    write(host, paragraph, [a('left', 'isVisible', false)]);
    expect(savedMainXml(host)).not.toContain('pBdr');
    const [top, left, bottom] = bordersOf(host, paragraph);
    expect([top.isVisible, left.isVisible, bottom.isVisible]).toEqual([true, false, true]);
  });

  test('writing back what is in force writes nothing, so a style border stays inherited', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    const before = savedMainXml(host);
    const response = write(host, paragraph, [
      a('top', 'isVisible', true),
      a('top', 'lineStyle', 'Double'),
      a('top', 'lineWidth', 'Pt075'),
      a('top', 'color', '#FF0000'),
      a('left', 'isVisible', false),
    ]);
    expect(response.results[0]?.status).toBe('ok');
    expect(savedMainXml(host)).toBe(before);
  });

  test('writing back the defaults a style edge leaves unstated changes nothing', () => {
    const style =
      '<w:style w:type="paragraph" w:styleId="Bare"><w:name w:val="Bare"/><w:pPr><w:pBdr>' +
      '<w:top w:val="nil"/><w:bottom w:val="single"/></w:pBdr></w:pPr></w:style>';
    const host = open(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Bare"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
        RULED_STYLE + style
      )
    );
    const before = savedMainXml(host);
    write(host, only(host), [
      a('bottom', 'lineWidth', 'Pt050'),
      a('bottom', 'colorIndex', 'Auto'),
      a('top', 'isVisible', false),
      a('top', 'lineStyle', 'None'),
    ]);
    expect(savedMainXml(host)).toBe(before);
  });

  test('a border resolves against the style the same write applies', () => {
    const host = open(docx(p('plain'), RULED_STYLE));
    const paragraph = only(host);
    write(host, paragraph, [a('bottom', 'lineWidth', 'Pt300')], { style: 'Ruled' });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:pStyle w:val="Ruled"/>');
    expect(xml).toContain(
      '<w:pBdr><w:bottom w:color="auto" w:space="1" w:sz="24" w:val="single"/></w:pBdr>'
    );
  });

  test('an out-of-range style edge clamps instead of refusing the write', () => {
    const style =
      '<w:style w:type="paragraph" w:styleId="Wide"><w:name w:val="Wide"/><w:pPr><w:pBdr>' +
      '<w:bottom w:val="single" w:sz="300" w:space="40"/></w:pBdr></w:pPr></w:style>';
    const host = open(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Wide"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
        RULED_STYLE + style
      )
    );
    const response = write(host, only(host), [
      a('top', 'lineStyle', 'Single'),
      a('bottom', 'color', '#00FF00'),
    ]);
    expect(response.results[0]?.status).toBe('ok');
    expect(savedMainXml(host)).toContain(
      '<w:bottom w:color="00FF00" w:space="31" w:sz="255" w:val="single"/>'
    );
  });

  test('a size with leading zeros keeps its value', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="0008" w:space="02"/></w:pBdr></w:pPr>' +
          '<w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    write(host, only(host), [a('bottom', 'color', '#00FF00')]);
    expect(savedMainXml(host)).toContain(
      '<w:bottom w:color="00FF00" w:space="02" w:sz="8" w:val="single"/>'
    );
  });

  test('borders and other paragraph properties share one write and survive a reopen', () => {
    const host = open(docx(p('plain')));
    const response = write(host, only(host), [a('top', 'lineStyle', 'Triple')], {
      alignment: 'Centered',
    });
    expect(response.results[0]?.status).toBe('ok');
    const reopened = reopen(host);
    const paragraph = paragraphsOf(reopened.host, reopened.body)[0]!;
    expect(bordersOf(reopened.host, paragraph)[0]).toMatchObject({ lineStyle: 'Triple' });
    expect(savedMainXml(reopened.host)).toContain('<w:jc w:val="center"/>');
  });

  test('a write keeps w:bar and the attributes the request does not name', () => {
    const host = open(
      docx(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="6" w:shadow="1"/>' +
          '<w:bar w:val="single" w:sz="4"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
      )
    );
    write(host, only(host), [a('bottom', 'lineWidth', 'Pt225')]);
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:bottom w:shadow="1" w:space="6" w:sz="18" w:val="single"/>');
    expect(xml).toContain('<w:bar w:sz="4" w:val="single"/>');
  });

  const refused: readonly [string, unknown][] = [
    ['an edge Office does not address', [a('bar', 'isVisible', true)]],
    ['an unknown edge', [a('middle', 'isVisible', true)]],
    ['an unknown property', [a('top', 'width', 'Pt050')]],
    ['an unknown line style', [a('top', 'lineStyle', 'Zigzag')]],
    ['a lower-case line style', [a('top', 'lineStyle', 'single')]],
    ['an unknown width', [a('top', 'lineStyle', 'Single'), a('top', 'lineWidth', 'Pt200')]],
    ['a colour without a hash', [a('top', 'color', 'FF0000')]],
    ['a colour name', [a('top', 'color', 'red')]],
    ['a palette entry this host cannot resolve', [a('top', 'colorIndex', 'ByAuthor')]],
    ['a visibility that is not a boolean', [a('top', 'isVisible', 'yes')]],
    ['an assignment that is not an object', [true]],
    ['borders by edge rather than a list', { top: { isVisible: true } }],
    ['too many assignments', Array.from({ length: 1025 }, () => a('top', 'isVisible', true))],
  ];
  for (const [name, borders] of refused) {
    test(`refuses ${name} and changes nothing`, () => {
      const host = open(docx(p('plain')));
      const before = savedMainXml(host);
      const response = write(host, only(host), borders as AutomationParagraphBordersWrite);
      expect(refusal(response)).toBe('unsupported-content');
      expect(savedMainXml(host)).toBe(before);
    });
  }
});

describe('tracked paragraph borders', () => {
  const TRACK = { op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Agent' } as const;

  test('records one paragraph property change that reject reverts', () => {
    const host = open(docx(ruled('ruled'), RULED_STYLE));
    const paragraph = only(host);
    const before = savedMainXml(host);
    const response = host.execute({
      operations: [
        TRACK,
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph },
          format: { alignment: 'Right', borders: [a('bottom', 'lineStyle', 'Double')] },
        },
      ],
    });
    expect(response.results.map((result) => result.status)).toEqual(['ok', 'ok']);
    const xml = savedMainXml(host);
    expect(xml.match(/<w:pPrChange /g)?.length).toBe(1);
    expect(xml).toMatch(
      /<w:pPrChange w:author="Agent"[^>]*><w:pPr><w:pStyle w:val="Ruled"\/><\/w:pPr>/
    );
    host.execute({ operations: [{ op: 'rejectAllRevisions', document: roots(host).document }] });
    expect(savedMainXml(host)).toBe(before);
  });

  test('accept keeps the border and drops the record', () => {
    const host = open(docx(p('plain')));
    const paragraph = only(host);
    host.execute({
      operations: [
        TRACK,
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph },
          format: { borders: [a('top', 'isVisible', true)] },
        },
      ],
    });
    host.execute({ operations: [{ op: 'acceptAllRevisions', document: roots(host).document }] });
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:top w:color="auto" w:space="0" w:sz="4" w:val="single"/>');
    expect(xml).not.toContain('pPrChange');
  });
});

describe('locked paragraph borders', () => {
  test('a content lock refuses a border write', () => {
    const host = open(
      docx(
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
          p('locked') +
          '</w:sdtContent></w:sdt>'
      )
    );
    const before = savedMainXml(host);
    const response = write(host, only(host), [a('bottom', 'lineStyle', 'Single')]);
    expect(response.results[0]?.status).toBe('error');
    expect(savedMainXml(host)).toBe(before);
  });
});
