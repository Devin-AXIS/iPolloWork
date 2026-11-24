// DrawingML text bodies lowered to read-only WordprocessingML stories: typed nodes, every
// stated property, escaping at the markup boundary, and the bounds that refuse a body.

import { describe, expect, test } from 'bun:test';
import {
  lowerDrawingTextBody,
  type DrawingTextDefaults,
  type LoweredDrawingText,
  type TextBodyLowering,
} from '../package/drawingml-text-lowering.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { A, DSP } from './smartart-fixture.ts';

const DEFAULTS: DrawingTextDefaults = { fontSlot: 'minor', color: { hex: 'FFFFFF', alpha: 1 } };
const SCHEME: Record<string, string> = { accent1: '4F81BD', lt1: 'FFFFFF', dk1: '000000' };
const resolveScheme = (token: string) => SCHEME[token] ?? null;

function txBody(inner: string): OoxmlElement {
  const parsed = readOoxmlPart(
    `<dsp:txBody xmlns:dsp="${DSP}" xmlns:a="${A}">${inner}</dsp:txBody>`,
    {
      name: '/word/diagrams/drawing1.xml',
      contentType: 'application/xml',
    }
  );
  if (!parsed.ok) throw new Error('parse failed');
  return parsed.part.root;
}

function lowerRaw(inner: string, defaults: DrawingTextDefaults = DEFAULTS): TextBodyLowering {
  return lowerDrawingTextBody(
    txBody(inner),
    '/word/diagrams/drawing1.xml#text:1',
    defaults,
    resolveScheme
  );
}

/** A body that lowers to text; any other outcome fails the test. */
function lower(inner: string, defaults: DrawingTextDefaults = DEFAULTS): LoweredDrawingText {
  const lowered = lowerRaw(inner, defaults);
  if (typeof lowered === 'string') throw new Error(`expected text, got ${lowered}`);
  return lowered;
}

function paragraph(pPr: string, runs: string): string {
  return `<a:p>${pPr}${runs}</a:p>`;
}

function run(text: string, rPr = '<a:rPr lang="en-US" sz="1400"/>'): string {
  return `<a:r>${rPr}<a:t>${text}</a:t></a:r>`;
}

const BODY = '<a:bodyPr/><a:lstStyle/>';

function all(root: OoxmlNode, localName: string): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const stack: OoxmlNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.localName === localName) out.push(node);
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  return out;
}

function value(element: OoxmlElement | undefined, name = 'val'): string | undefined {
  return element?.attributes.find((attribute) => attribute.localName === name)?.value;
}

function texts(root: OoxmlNode): string[] {
  return all(root, 't').map((t) =>
    t.children.map((child) => (child.kind === 'textValue' ? child.value : '')).join('')
  );
}

/** Run properties of the content runs (paragraph mark properties excluded). */
function runProps(root: OoxmlNode): OoxmlElement[] {
  return all(root, 'r').map((r) => all(r, 'rPr')[0]!);
}

describe('DrawingML text lowering', () => {
  test('produces typed paragraphs and runs under a txbxContent root', () => {
    const lowered = lower(BODY + paragraph('<a:pPr algn="ctr"/>', run('Alpha')))!;
    expect(lowered.content.localName).toBe('txbxContent');
    const [p] = all(lowered.content, 'p');
    expect(p!.kind).toBe('paragraph');
    expect(all(p!, 'r')[0]!.kind).toBe('run');
    expect(texts(lowered.content)).toEqual(['Alpha']);
    expect(lowered.content.id.startsWith('/word/diagrams/drawing1.xml#text:1')).toBe(true);
  });

  test('escapes markup characters in text and typefaces', () => {
    const lowered = lower(
      BODY +
        paragraph(
          '',
          run(
            'a &lt; b &amp; "c" \'d\'',
            '<a:rPr sz="1400"><a:latin typeface="Face &quot;&lt;&amp;"/></a:rPr>'
          )
        )
    )!;
    expect(texts(lowered.content)).toEqual([`a < b & "c" 'd'`]);
    const fonts = all(runProps(lowered.content)[0]!, 'rFonts')[0]!;
    expect(value(fonts, 'ascii')).toBe('Face "<&');
  });

  test('converts sizes to half points, defaults to 18 pt and applies the autofit font scale', () => {
    const sized = lower(BODY + paragraph('', run('x', '<a:rPr sz="2300"/>')))!;
    expect(value(all(runProps(sized.content)[0]!, 'sz')[0])).toBe('46');
    const unsized = lower(BODY + paragraph('', run('x', '<a:rPr/>')))!;
    expect(value(all(runProps(unsized.content)[0]!, 'sz')[0])).toBe('36');
    const scaled = lower(
      '<a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>' +
        paragraph('', run('x', '<a:rPr sz="2000"/>'))
    )!;
    expect(value(all(runProps(scaled.content)[0]!, 'sz')[0])).toBe('20');
  });

  test('maps theme font tokens to theme slots and keeps explicit faces', () => {
    const themed = lower(
      BODY +
        paragraph(
          '',
          run(
            'x',
            '<a:rPr sz="1400"><a:latin typeface="+mn-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mn-cs"/></a:rPr>'
          )
        )
    )!;
    const fonts = all(runProps(themed.content)[0]!, 'rFonts')[0]!;
    expect(value(fonts, 'asciiTheme')).toBe('minorHAnsi');
    expect(value(fonts, 'hAnsiTheme')).toBe('minorHAnsi');
    expect(value(fonts, 'eastAsiaTheme')).toBe('majorEastAsia');
    expect(value(fonts, 'cstheme')).toBe('minorBidi');
    const major = lower(BODY + paragraph('', run('x')), { fontSlot: 'major', color: null })!;
    expect(value(all(runProps(major.content)[0]!, 'rFonts')[0], 'asciiTheme')).toBe('majorHAnsi');
    const explicit = lower(
      BODY + paragraph('', run('x', '<a:rPr><a:latin typeface="Arial"/></a:rPr>'))
    )!;
    expect(value(all(runProps(explicit.content)[0]!, 'rFonts')[0], 'ascii')).toBe('Arial');
  });

  test('colours come from the run fill, then the style font colour, then black', () => {
    const own = lower(
      BODY +
        paragraph(
          '',
          run('x', '<a:rPr><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:rPr>')
        )
    )!;
    expect(value(all(runProps(own.content)[0]!, 'color')[0])).toBe('C00000');
    const scheme = lower(
      BODY +
        paragraph(
          '',
          run(
            'x',
            '<a:rPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></a:rPr>'
          )
        )
    )!;
    // The scheme colour goes through the shared transform path (lumMod in HSL).
    expect(value(all(runProps(scheme.content)[0]!, 'color')[0])).toBe('254061');
    const inherited = lower(BODY + paragraph('', run('x')))!;
    expect(value(all(runProps(inherited.content)[0]!, 'color')[0])).toBe('FFFFFF');
    const none = lower(BODY + paragraph('', run('x')), { fontSlot: null, color: null })!;
    expect(value(all(runProps(none.content)[0]!, 'color')[0])).toBe('000000');
  });

  test('states bold, italic and underline explicitly', () => {
    const lowered = lower(BODY + paragraph('', run('x', '<a:rPr b="1" i="0" u="sng"/>')))!;
    const rPr = runProps(lowered.content)[0]!;
    expect(value(all(rPr, 'b')[0])).toBe('1');
    expect(value(all(rPr, 'i')[0])).toBe('0');
    expect(value(all(rPr, 'u')[0])).toBe('single');
  });

  test('maps paragraph alignment', () => {
    for (const [algn, jc] of [
      ['l', 'left'],
      ['ctr', 'center'],
      ['r', 'right'],
      ['just', 'both'],
      ['dist', 'distribute'],
    ] as const) {
      const lowered = lower(BODY + paragraph(`<a:pPr algn="${algn}"/>`, run('x')))!;
      expect(value(all(lowered.content, 'jc')[0])).toBe(jc);
    }
    expect(value(all(lower(BODY + paragraph('', run('x')))!.content, 'jc')[0])).toBe('left');
  });

  test('percentage line spacing is an auto multiple; point spacing is exact', () => {
    const percent = lower(
      BODY + paragraph('<a:pPr><a:lnSpc><a:spcPct val="90000"/></a:lnSpc></a:pPr>', run('x'))
    )!;
    const spacing = all(percent.content, 'spacing').find((node) => value(node, 'line'))!;
    expect(value(spacing, 'line')).toBe('216');
    expect(value(spacing, 'lineRule')).toBe('auto');
    const points = lower(
      BODY + paragraph('<a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:pPr>', run('x'))
    )!;
    const exact = all(points.content, 'spacing').find((node) => value(node, 'line'))!;
    expect(value(exact, 'line')).toBe('360');
    expect(value(exact, 'lineRule')).toBe('exact');
  });

  test('the autofit line reduction lowers the multiple', () => {
    const lowered = lower(
      '<a:bodyPr><a:normAutofit lnSpcReduction="20000"/></a:bodyPr>' + paragraph('', run('x'))
    )!;
    expect(
      value(
        all(lowered.content, 'spacing').find((node) => value(node, 'line')),
        'line'
      )
    ).toBe('192');
  });

  test('without spcFirstLastPara the first paragraph has no space before and the last none after', () => {
    const pPr =
      '<a:pPr><a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="1200"/></a:spcAft></a:pPr>';
    const lowered = lower(BODY + paragraph(pPr, run('one')) + paragraph(pPr, run('two')))!;
    const spacings = all(lowered.content, 'spacing').filter((node) => value(node, 'line'));
    expect([value(spacings[0], 'before'), value(spacings[0], 'after')]).toEqual(['0', '240']);
    expect([value(spacings[1], 'before'), value(spacings[1], 'after')]).toEqual(['120', '0']);
    const kept = lower('<a:bodyPr spcFirstLastPara="1"/>' + paragraph(pPr, run('one')))!;
    const only = all(kept.content, 'spacing').find((node) => value(node, 'line'))!;
    expect([value(only, 'before'), value(only, 'after')]).toEqual(['120', '240']);
  });

  test('percentage paragraph spacing is a share of 1.2 times the first run size', () => {
    const pPr = '<a:pPr><a:spcAft><a:spcPct val="50000"/></a:spcAft></a:pPr>';
    const lowered = lower(
      BODY + paragraph(pPr, run('one', '<a:rPr sz="2000"/>')) + paragraph('', run('two'))
    )!;
    // 0.5 × 20 pt × 1.2 = 12 pt = 240 twips.
    expect(
      value(
        all(lowered.content, 'spacing').find((node) => value(node, 'line')),
        'after'
      )
    ).toBe('240');
  });

  test('character bullets hang at the indent with a tab stop at the text margin', () => {
    const lowered = lower(
      BODY +
        paragraph(
          '<a:pPr marL="114300" indent="-114300"><a:buFont typeface="Arial"/><a:buSzPct val="50000"/>' +
            '<a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buChar char="•"/></a:pPr>',
          run('item', '<a:rPr sz="2000"/>')
        )
    )!;
    expect(texts(lowered.content)).toEqual(['•', 'item']);
    const ind = all(lowered.content, 'ind')[0]!;
    expect([value(ind, 'left'), value(ind, 'hanging')]).toEqual(['180', '180']);
    const stop = all(all(lowered.content, 'tabs')[0]!, 'tab')[0]!;
    expect([value(stop, 'val'), value(stop, 'pos')]).toEqual(['left', '180']);
    const [bulletRun, tabRun] = all(lowered.content, 'r');
    expect(all(tabRun!, 'tab')).toHaveLength(1);
    const bulletProps = all(bulletRun!, 'rPr')[0]!;
    expect(value(all(bulletProps, 'rFonts')[0], 'ascii')).toBe('Arial');
    expect(value(all(bulletProps, 'sz')[0])).toBe('20');
    expect(value(all(bulletProps, 'color')[0])).toBe('FF0000');
  });

  test('a bullet follows the first run when it names nothing of its own', () => {
    const lowered = lower(
      BODY +
        paragraph(
          '<a:pPr marL="0" indent="0"><a:buChar char="-"/></a:pPr>',
          run('x', '<a:rPr sz="1100"/>')
        )
    )!;
    const bulletProps = all(all(lowered.content, 'r')[0]!, 'rPr')[0]!;
    expect(value(all(bulletProps, 'sz')[0])).toBe('22');
  });

  test('buNone and empty paragraphs add no bullet', () => {
    const lowered = lower(
      BODY +
        paragraph('<a:pPr><a:buNone/></a:pPr>', run('x')) +
        paragraph('<a:pPr><a:buChar char="•"/></a:pPr>', '<a:endParaRPr sz="1400"/>')
    )!;
    expect(texts(lowered.content)).toEqual(['x']);
  });

  test('level properties come from the list style', () => {
    const lowered = lower(
      '<a:bodyPr/><a:lstStyle><a:lvl2pPr algn="r" marL="457200"/></a:lstStyle>' +
        paragraph('<a:pPr lvl="1"/>', run('x'))
    )!;
    expect(value(all(lowered.content, 'jc')[0])).toBe('right');
    expect(value(all(lowered.content, 'ind')[0], 'left')).toBe('720');
  });

  test('a line break lowers to w:br', () => {
    const lowered = lower(
      BODY + paragraph('', run('a') + '<a:br><a:rPr sz="1400"/></a:br>' + run('b'))
    )!;
    expect(all(lowered.content, 'br')).toHaveLength(1);
    expect(texts(lowered.content)).toEqual(['a', 'b']);
  });

  test('reads insets, anchor, wrap and the body turn', () => {
    const lowered = lower(
      '<a:bodyPr lIns="1" tIns="2" rIns="3" bIns="4" anchor="b" wrap="none" rot="5400000"/>' +
        paragraph('', run('x'))
    )!;
    expect(lowered.insetsEmu).toEqual({ top: 2, right: 3, bottom: 4, left: 1 });
    expect(lowered.verticalAnchor).toBe('bottom');
    expect(lowered.noWrap).toBe(true);
    expect(lowered.rotationDegrees).toBe(90);
    const defaults = lower(BODY + paragraph('', run('x')))!;
    expect(defaults.insetsEmu).toEqual({ top: 45720, right: 91440, bottom: 45720, left: 91440 });
    expect(defaults.verticalAnchor).toBe('top');
  });

  test('turns vertical text a quarter and refuses other vertical modes and columns', () => {
    const insets = 'lIns="1" tIns="2" rIns="3" bIns="4"';
    const clockwise = lowerRaw(`<a:bodyPr vert="vert" ${insets}/>` + paragraph('', run('x')));
    expect(clockwise).toMatchObject({
      quarterTurn: 90,
      insetsEmu: { top: 3, right: 4, bottom: 1, left: 2 },
    });
    const counter = lowerRaw(`<a:bodyPr vert="vert270" ${insets}/>` + paragraph('', run('x')));
    expect(counter).toMatchObject({
      quarterTurn: 270,
      insetsEmu: { top: 1, right: 2, bottom: 3, left: 4 },
    });
    expect(lowerRaw('<a:bodyPr vert="horz"/>' + paragraph('', run('x')))).toMatchObject({
      quarterTurn: 0,
    });
    expect(lowerRaw('<a:bodyPr vert="eaVert"/>' + paragraph('', run('x')))).toBe('unsupported');
    expect(lowerRaw('<a:bodyPr numCol="2"/>' + paragraph('', run('x')))).toBe('unsupported');
  });

  test('a body with no visible text lowers to nothing', () => {
    expect(lowerRaw(BODY)).toBe('no-text');
    expect(lowerRaw(BODY + paragraph('', '<a:endParaRPr/>'))).toBe('no-text');
    expect(lowerRaw(BODY + paragraph('', run('   ')))).toBe('no-text');
  });

  test('refuses bodies past the paragraph and run bounds', () => {
    const paragraphs = Array.from({ length: 257 }, () => paragraph('', run('x'))).join('');
    expect(lowerRaw(BODY + paragraphs)).toBe('unsupported');
    const runs = Array.from({ length: 2049 }, () => run('x')).join('');
    expect(lowerRaw(BODY + paragraph('', runs))).toBe('unsupported');
  });

  test('a kerning threshold carries over in half points, and zero leaves kerning off', () => {
    const kerned = lower(
      BODY + paragraph('', run('AV', '<a:rPr lang="en-US" sz="1400" kern="1200"/>'))
    );
    expect(all(kerned.content, 'kern').map((element) => value(element))).toContain('24');
    const plain = lower(
      BODY + paragraph('', run('AV', '<a:rPr lang="en-US" sz="1400" kern="0"/>'))
    );
    expect(all(plain.content, 'kern')).toEqual([]);
  });

  test('a long typeface name falls back to the theme font instead of repeating per run', () => {
    const face = 'F'.repeat(4096);
    const runs = Array.from(
      { length: 64 },
      () => `<a:r><a:rPr lang="en-US"><a:latin typeface="${face}"/></a:rPr><a:t>x</a:t></a:r>`
    ).join('');
    const lowered = lowerRaw(BODY + paragraph('', runs));
    if (typeof lowered === 'string') throw new Error(`expected text, got ${lowered}`);
    expect(JSON.stringify(lowered.content)).not.toContain(face);
    expect(JSON.stringify(lowered.content)).toContain('minorHAnsi');
  });

  test('refuses text with characters XML 1.0 cannot carry', () => {
    const body = txBody(BODY + paragraph('', run('placeholder')));
    // Swap the parsed text for a control character the parser itself would reject.
    const swap = (node: OoxmlNode): OoxmlNode =>
      node.kind === 'textValue'
        ? { ...node, value: 'bad\u0001' }
        : ({ ...node, children: node.children.map(swap) } as OoxmlNode);
    const poisoned = swap(body) as OoxmlElement;
    expect(lowerDrawingTextBody(poisoned, '/x.xml', DEFAULTS, resolveScheme)).toBe('unsupported');
  });
});
