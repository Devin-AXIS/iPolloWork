// External `text/html` → WordprocessingML fragment package (rich-clipboard-fidelity
// tasks 5.1-5.4). Every fixture round-trips through `readOoxmlPackage`, the same
// bounded reader the paste router uses, so the assertions cover both the projection
// and the fragment's validity as an OPC package.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { WORD_STYLE_TEXT_MAX, wordClassAlignmentsFromStyleText } from '../clipboard-html-styles.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { strFromU8 } from '../../store/package/zip.ts';

/** A valid 1x1 PNG (signature, IHDR 1x1 8-bit RGBA, IDAT, IEND). */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngWithPhysicalSize(width: number, height: number, pixelsPerMeter: number): string {
  const source = Uint8Array.from(atob(TINY_PNG_BASE64), (char) => char.charCodeAt(0));
  const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  writeUint32(source, 16, width);
  writeUint32(source, 20, height);
  const phys = Uint8Array.from([
    0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
  ]);
  writeUint32(phys, 8, pixelsPerMeter);
  writeUint32(phys, 12, pixelsPerMeter);
  const bytes = new Uint8Array(source.length + phys.length);
  bytes.set(source.subarray(0, 33));
  bytes.set(phys, 33);
  bytes.set(source.subarray(33), 33 + phys.length);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

interface OpenedFragment {
  readonly pkg: OoxmlPackage;
  readonly docXml: string;
  readonly relsXml: string;
  readonly lastMarkCovered: boolean;
}

/** Project, read back through the bounded package reader, and serialize the body. */
function openFragment(html: string): OpenedFragment {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(`projection refused: ${projected.reason}`);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(`read-back refused: ${read.reason}`);
  const pkg = read.package;
  const part = pkg.parts.get('/word/document.xml');
  if (!part) throw new Error('fragment lost its document part');
  const relsBytes = pkg.partBytes.get('/word/_rels/document.xml.rels');
  return {
    pkg,
    docXml: serializeOoxmlPart(part),
    relsXml: relsBytes ? strFromU8(relsBytes) : '',
    lastMarkCovered: projected.lastMarkCovered,
  };
}

describe('run and paragraph mapping', () => {
  test('headings become bold direct formatting at Word sizes', () => {
    const { docXml, lastMarkCovered } = openFragment('<h1>Alpha</h1><h3>Beta</h3>');
    expect(docXml).toContain('w:sz w:val="64"');
    expect(docXml).toContain('w:sz w:val="44"');
    expect(docXml).toContain('<w:b/>');
    expect(docXml).toContain('Alpha');
    expect(docXml).toContain('Beta');
    expect(docXml).not.toContain('<w:pStyle');
    expect(lastMarkCovered).toBe(false);
  });

  test('a Heading class on a heading tag maps to the style in every dialect', () => {
    const { docXml } = openFragment('<h2 class="Heading2">Marked</h2>');
    expect(docXml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(docXml).not.toContain('<w:b/>');
  });

  test('fragment-only Word Heading 1 through 4 use their target styles', () => {
    for (const level of [1, 2, 3, 4]) {
      const html =
        `<!--StartFragment--><h${level}><span style="mso-ansi-language:PL">` +
        `Heading ${level}<o:p></o:p></span></h${level}><!--EndFragment-->`;
      const { docXml, lastMarkCovered } = openFragment(html);
      expect(docXml).toContain(`<w:pStyle w:val="Heading${level}"/>`);
      expect(docXml).not.toContain('<w:b/>');
      expect(lastMarkCovered).toBe(true);
    }
  });

  test('Word desktop and online heading classes map to target styles', () => {
    const { docXml, lastMarkCovered } = openFragment(
      '<p class="MsoHeading2">Desktop</p><p class="Heading3">Online</p>'
    );
    expect(docXml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(docXml).toContain('<w:pStyle w:val="Heading3"/>');
    expect(lastMarkCovered).toBe(true);
  });

  test('Word caption classes use target styles and include their paragraph mark', () => {
    const { docXml, lastMarkCovered } = openFragment(
      '<p class="MsoCaption" style="text-align:center">Figure 1</p>'
    );
    expect(docXml).toContain('<w:pStyle w:val="Caption"/>');
    expect(docXml).toContain('<w:jc w:val="center"/>');
    expect(lastMarkCovered).toBe(true);
  });

  test('generic paragraphs keep the host paragraph mark', () => {
    const { lastMarkCovered } = openFragment('<p>ordinary</p>');
    expect(lastMarkCovered).toBe(false);
  });

  test('only the final projected block controls paragraph mark coverage', () => {
    const { lastMarkCovered } = openFragment(
      '<p class="MsoCaption">caption</p><p>ordinary tail</p>'
    );
    expect(lastMarkCovered).toBe(false);
  });

  test('inline tags and CSS map to run properties', () => {
    const { docXml } = openFragment(
      '<p><b>bold</b><i>italic</i><u>under</u><s>gone</s><sub>low</sub>' +
        '<span style="color:#ff0000;font-size:16px;font-family:\'Georgia\', serif">red</span>' +
        '<span style="background-color:rgb(255,255,0)">mark</span></p>'
    );
    expect(docXml).toContain('<w:b/>');
    expect(docXml).toContain('<w:i/>');
    expect(docXml).toContain('w:u w:val="single"');
    expect(docXml).toContain('<w:strike/>');
    expect(docXml).toContain('w:vertAlign w:val="subscript"');
    expect(docXml).toContain('w:color w:val="FF0000"');
    expect(docXml).toContain('w:sz w:val="24"'); // 16px = 12pt = 24 half-points
    expect(docXml).toContain('w:ascii="Georgia"');
    expect(docXml).toContain('w:fill="FFFF00"');
  });

  test('Word highlighter named colours become w:highlight, not shading', () => {
    const cases: Array<{ css: string; val: string; text: string }> = [
      { css: 'background:yellow;mso-highlight:yellow', val: 'yellow', text: 'y' },
      { css: 'background:aqua;mso-highlight:aqua', val: 'cyan', text: 'a' },
      { css: 'background:fuchsia;mso-highlight:fuchsia', val: 'magenta', text: 'f' },
      { css: 'background:lime;mso-highlight:lime', val: 'green', text: 'l' },
      { css: 'background:olive;mso-highlight:olive', val: 'darkYellow', text: 'o' },
    ];
    const html = `<p>${cases
      .map((entry) => `<span style="${entry.css}">${entry.text}</span>`)
      .join('')}</p>`;
    const { docXml } = openFragment(html);
    for (const entry of cases) {
      const run = docXml.split('<w:r>').find((piece) => piece.includes(`>${entry.text}<`));
      expect(run).toBeDefined();
      expect(run!).toContain(`w:highlight w:val="${entry.val}"`);
      expect(run!).not.toContain('w:shd');
    }
  });

  test('a named background colour without mso-highlight remains shading', () => {
    const { docXml } = openFragment('<p><span style="background:yellow">y</span></p>');
    const run = docXml.split('<w:r>').find((piece) => piece.includes('>y<'));
    expect(run).not.toContain('w:highlight');
    expect(run).toContain('<w:shd ');
    expect(run).toContain('w:fill="FFFF00"');
  });

  test('background shorthand that is not a solid colour is refused', () => {
    const { docXml } = openFragment(
      '<p><span style="background:yellow url(https://evil.example/x.png)">keep</span>' +
        '<span style="background:url(https://evil.example/x.png)">also</span></p>'
    );
    const keep = docXml.split('<w:r>').find((piece) => piece.includes('>keep<'));
    const also = docXml.split('<w:r>').find((piece) => piece.includes('>also<'));
    expect(keep).toBeDefined();
    expect(keep!).not.toContain('w:highlight');
    expect(keep!).not.toContain('w:shd');
    expect(also!).not.toContain('w:highlight');
    expect(also!).not.toContain('w:shd');
    expect(docXml).not.toContain('evil.example');
  });

  test('font-weight CSS overrides in both directions', () => {
    const { docXml } = openFragment(
      '<p><b style="font-weight:normal">off</b><span style="font-weight:700">on</span></p>'
    );
    const runs = docXml.split('<w:r>');
    const offRun = runs.find((run) => run.includes('>off<'));
    const onRun = runs.find((run) => run.includes('>on<'));
    expect(offRun).toBeDefined();
    expect(offRun!).not.toContain('<w:b/>');
    expect(onRun!).toContain('<w:b/>');
  });

  test('Word caps and underline variants remain run properties', () => {
    const { docXml } = openFragment(
      '<p><span style="font-variant:small-caps">small</span>' +
        '<span style="text-transform:uppercase">caps</span>' +
        '<u style="text-underline:red wave;letter-spacing:1.5pt">wave</u>' +
        '<span style="text-decoration-line:line-through;text-decoration-style:double">' +
        'double</span></p>'
    );
    const runs = docXml.split('<w:r>');
    expect(runs.find((run) => run.includes('small'))).toContain('<w:smallCaps/>');
    expect(runs.find((run) => run.includes('caps'))).toContain('<w:caps/>');
    const wave = runs.find((run) => run.includes('wave'));
    expect(wave).toContain('w:val="wave"');
    expect(wave).toContain('w:color="FF0000"');
    expect(wave).toContain('<w:spacing w:val="30"/>');
    expect(runs.find((run) => run.includes('double'))).toContain('<w:dstrike/>');
  });

  test('HTML language and right-to-left direction remain semantic', () => {
    const { docXml } = openFragment(
      '<p dir="rtl"><span lang="ar-SA" style="direction:rtl;font-family:Amiri">مرحبا</span></p>'
    );
    expect(docXml).toContain('<w:bidi/>');
    expect(docXml).toContain('<w:rtl/>');
    expect(docXml).toContain('w:cs="Amiri"');
    expect(docXml).not.toContain('w:ascii="Amiri"');
    // An RTL run's language tag is the BIDI language: writing it to w:val would
    // overwrite the Latin slot with the wrong dictionary.
    expect(docXml).toContain('<w:lang w:bidi="ar-SA"/>');
  });

  test('paragraph CSS maps to jc, spacing and ind', () => {
    const { docXml } = openFragment(
      '<p style="text-align:center;line-height:1.5">mid</p>' +
        '<p style="margin-left:48px;text-indent:-24px">hang</p>' +
        '<p style="text-align:justify;text-indent:24px">first</p>'
    );
    expect(docXml).toContain('w:jc w:val="center"');
    expect(docXml).toContain('w:line="360"'); // 240 * 1.5
    expect(docXml).toContain('w:lineRule="auto"');
    expect(docXml).toContain('w:left="720"'); // 48px = 36pt = 720 twips
    expect(docXml).toContain('w:hanging="360"');
    expect(docXml).toContain('w:jc w:val="both"');
    expect(docXml).toContain('w:firstLine="360"');
  });

  test('Word absolute line heights preserve exact and at-least rules', () => {
    const { docXml } = openFragment(
      '<p style="line-height:18pt;mso-line-height-rule:exactly">exact</p>' +
        '<p style="line-height:20pt;mso-line-height-rule:at-least">minimum</p>'
    );
    const exact = docXml.split('</w:p>').find((part) => part.includes('exact'));
    const minimum = docXml.split('</w:p>').find((part) => part.includes('minimum'));
    expect(exact).toContain('w:line="360"');
    expect(exact).toContain('w:lineRule="exact"');
    expect(minimum).toContain('w:line="400"');
    expect(minimum).toContain('w:lineRule="atLeast"');
  });

  test('Word paragraph geometry maps absolute lengths and percentage line spacing', () => {
    const { docXml } = openFragment(
      '<p style="margin-top:10pt;margin-right:.25in;margin-bottom:20pt;' +
        'margin-left:.5in;text-indent:-.25in;line-height:115%;' +
        'page-break-before:always;page-break-after:avoid;page-break-inside:avoid;' +
        'widows:2;background:#DDEEFF;tab-stops:right dotted 467.5pt;' +
        'mso-border-bottom-alt:solid #2B6CB0 .75pt">geometry</p>'
    );
    const paragraph = docXml.split('</w:p>').find((part) => part.includes('geometry'));
    expect(paragraph).toBeDefined();
    expect(paragraph!).toContain('<w:keepNext/>');
    expect(paragraph!).toContain('<w:keepLines/>');
    expect(paragraph!).toContain('<w:pageBreakBefore/>');
    expect(paragraph!).toContain('<w:widowControl/>');
    expect(paragraph!).toContain('w:before="200"');
    expect(paragraph!).toContain('w:after="400"');
    expect(paragraph!).toContain('w:line="276"');
    expect(paragraph!).toContain('w:lineRule="auto"');
    expect(paragraph!).toContain('w:left="720"');
    expect(paragraph!).toContain('w:right="360"');
    expect(paragraph!).toContain('w:hanging="360"');
    expect(paragraph!).toContain('<w:tab ');
    expect(paragraph!).toContain('w:val="right"');
    expect(paragraph!).toContain('w:pos="9350"');
    expect(paragraph!).toContain('w:leader="dot"');
    expect(paragraph!).toContain('<w:bottom ');
    expect(paragraph!).toContain('w:val="single"');
    expect(paragraph!).toContain('w:sz="6"');
    expect(paragraph!).toContain('w:color="2B6CB0"');
    expect(paragraph!).toContain('w:fill="DDEEFF"');
    // The fill lands on the paragraph mark AND the run, so a mid-paragraph inline
    // paste (which keeps only run content) does not lose it.
    expect(paragraph!.match(/<w:shd/g)).toHaveLength(2);
  });

  test('Word CSS length units map to equivalent twip values', () => {
    const { docXml } = openFragment(
      '<p style="margin-left:1in">in</p>' +
        '<p style="margin-left:2.54cm">cm</p>' +
        '<p style="margin-left:25.4mm">mm</p>' +
        '<p style="margin-left:6pc">pc</p>'
    );
    expect(docXml.match(/w:left="1440"/g)).toHaveLength(4);
  });

  test('unsafe or malformed paragraph CSS does not produce structure', () => {
    const { docXml } = openFragment(
      '<p style="tab-stops:right url(https://evil.example);' +
        'mso-border-bottom-alt:solid url(https://evil.example) 1pt">safe</p>'
    );
    expect(docXml).not.toContain('<w:tabs>');
    expect(docXml).not.toContain('<w:pBdr>');
    expect(docXml).not.toContain('evil.example');
  });

  test('Word stylesheet text-align on Title/Subtitle is copied as direct jc', () => {
    // Word clipboard HTML puts alignment in a detached <style> block. Title often
    // also carries inline text-align / align=center; Subtitle often does not.
    // The fragment has no styles.xml, so merge reuses the target Title/Subtitle
    // definitions, which have no w:jc. Direct jc on the paragraph is what survives.
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>' +
      '<!--' +
      'p.MsoTitle, li.MsoTitle, div.MsoTitle { text-align:center; }' +
      'p.MsoSubtitle, li.MsoSubtitle, div.MsoSubtitle { text-align:center; }' +
      'p.other { text-align:center; }' +
      '-->' +
      '</style></head><body>' +
      '<p class=MsoTitle align=center style="text-align:center">DOCX-EDITOR.DEV</p>' +
      '<p class=MsoSubtitle>ELEMENT TEST DOCUMENT</p>' +
      '<p class="other">not a Word title</p>' +
      '</body></html>';
    const { docXml } = openFragment(html);
    const paras = docXml.split('</w:p>');
    const title = paras.find((para) => para.includes('DOCX-EDITOR.DEV'));
    const subtitle = paras.find((para) => para.includes('ELEMENT TEST DOCUMENT'));
    const other = paras.find((para) => para.includes('not a Word title'));
    expect(title).toBeDefined();
    expect(subtitle).toBeDefined();
    expect(title!).toContain('<w:pStyle w:val="Title"/>');
    expect(title!).toContain('<w:jc w:val="center"/>');
    expect(subtitle!).toContain('<w:pStyle w:val="Subtitle"/>');
    expect(subtitle!).toContain('<w:jc w:val="center"/>');
    expect(other!).not.toContain('<w:jc w:val="center"/>');
  });

  test('a left-aligned Word Subtitle stylesheet is not forced to center', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>' +
      'p.MsoTitle { text-align:center; }' +
      'p.MsoSubtitle { text-align:left; }' +
      '</style></head><body>' +
      '<p class="MsoTitle">centred title</p>' +
      '<p class="MsoSubtitle">left subtitle</p>' +
      '</body></html>';
    const { docXml } = openFragment(html);
    const paras = docXml.split('</w:p>');
    const title = paras.find((para) => para.includes('centred title'));
    const subtitle = paras.find((para) => para.includes('left subtitle'));
    expect(title!).toContain('<w:jc w:val="center"/>');
    expect(subtitle!).toContain('<w:jc w:val="left"/>');
    expect(subtitle!).not.toContain('<w:jc w:val="center"/>');
  });

  test('a Word title class with no stylesheet alignment is not forced to center', () => {
    const { docXml } = openFragment('<p class="MsoSubtitle">plain subtitle</p>');
    const subtitle = docXml.split('</w:p>').find((para) => para.includes('plain subtitle'));
    expect(subtitle).toContain('<w:pStyle w:val="Subtitle"/>');
    expect(subtitle).not.toContain('<w:jc');
  });

  test('inline text-align on a Word title class still wins over the stylesheet', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>' +
      'p.MsoSubtitle { text-align:center; }' +
      '</style></head><body>' +
      '<p class="MsoSubtitle" style="text-align:left">left subtitle</p>' +
      '</body></html>';
    const { docXml } = openFragment(html);
    const subtitle = docXml.split('</w:p>').find((para) => para.includes('left subtitle'));
    expect(subtitle).toContain('<w:pStyle w:val="Subtitle"/>');
    expect(subtitle).toContain('<w:jc w:val="left"/>');
    expect(subtitle).not.toContain('<w:jc w:val="center"/>');
  });

  test('HTML align still wins over the stylesheet and loses to inline text-align', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>' +
      'p.MsoTitle { text-align:left; }' +
      '</style></head><body>' +
      '<p class="MsoTitle" align="center">from align</p>' +
      '<p class="MsoTitle" align="center" style="text-align:right">from inline</p>' +
      '</body></html>';
    const { docXml } = openFragment(html);
    const paras = docXml.split('</w:p>');
    const fromAlign = paras.find((para) => para.includes('from align'));
    const fromInline = paras.find((para) => para.includes('from inline'));
    expect(fromAlign!).toContain('<w:jc w:val="center"/>');
    expect(fromInline!).toContain('<w:jc w:val="right"/>');
    expect(fromInline!).not.toContain('<w:jc w:val="center"/>');
  });
});

describe('Word stylesheet class alignment scan', () => {
  test('unrelated and mixed selectors never contribute', () => {
    const alignments = wordClassAlignmentsFromStyleText(
      'p.other { text-align:center; }' +
        'p.MsoSubtitle, p.other { text-align:center; }' +
        'p .MsoSubtitle { text-align:center; }' +
        'p.MsoTitle { text-align:center; }'
    );
    expect(alignments.get('MsoTitle')).toBe('center');
    expect(alignments.get('MsoSubtitle')).toBeUndefined();
    expect(alignments.get('other')).toBeUndefined();
  });

  test('malformed CSS does not throw and does not apply a truncated rule', () => {
    const alignments = wordClassAlignmentsFromStyleText(
      'p.MsoSubtitle { text-align:center\n' + 'p.MsoTitle { text-align:right; }'
    );
    expect(alignments.size).toBe(0);
  });

  test('oversized CSS is refused rather than scanned', () => {
    const css = `${'x'.repeat(WORD_STYLE_TEXT_MAX + 1)}p.MsoSubtitle{text-align:center;}`;
    expect(wordClassAlignmentsFromStyleText(css).size).toBe(0);
  });

  test('text-align values with url() or functions are refused', () => {
    const alignments = wordClassAlignmentsFromStyleText(
      'p.MsoSubtitle { text-align:url(https://evil.example/); }' +
        'p.MsoTitle { text-align:center; }'
    );
    expect(alignments.get('MsoSubtitle')).toBeUndefined();
    expect(alignments.get('MsoTitle')).toBe('center');
  });
});

describe('lists', () => {
  test('semantic ol/ul nesting projects numPr and a fresh numbering part', () => {
    const { pkg, docXml, relsXml } = openFragment(
      '<ol><li>one</li><li>two<ul><li>sub</li></ul></li></ol>'
    );
    expect(docXml).toContain('w:ilvl w:val="0"');
    expect(docXml).toContain('w:ilvl w:val="1"');
    expect(docXml).toContain('w:numId w:val="1001"');
    const numberingBytes = pkg.partBytes.get('/word/numbering.xml');
    expect(numberingBytes).toBeDefined();
    const numberingXml = strFromU8(numberingBytes!);
    expect(numberingXml).toContain('w:abstractNum');
    expect(numberingXml).toContain('<w:num w:numId="1001">');
    expect(numberingXml).toContain('w:numFmt w:val="decimal"');
    expect(numberingXml).toContain('w:lvlText w:val="%1."');
    expect(relsXml).toContain('relationships/numbering');
  });

  test('each distinct top-level list allocates its own numId', () => {
    const { docXml, pkg } = openFragment('<ol><li>a</li></ol><ul><li>b</li></ul>');
    expect(docXml).toContain('w:numId w:val="1001"');
    expect(docXml).toContain('w:numId w:val="1002"');
    const numberingXml = strFromU8(pkg.partBytes.get('/word/numbering.xml')!);
    expect(numberingXml).toContain('w:numFmt w:val="decimal"');
    expect(numberingXml).toContain('w:numFmt w:val="bullet"');
  });

  test('list-style-type none remains a marker-suppressed numbering level', () => {
    const { pkg } = openFragment('<ol style="list-style-type:none"><li>marker-free item</li></ol>');
    const numberingXml = strFromU8(pkg.partBytes.get('/word/numbering.xml')!);
    expect(numberingXml).toContain('w:numFmt w:val="none"');
  });

  test('Word desktop mso-list markup maps to numbering; marker span never becomes text', () => {
    const html =
      '<p class="MsoListParagraph" style="text-indent:-18.0pt;mso-list:l3 level2 lfo5">' +
      '<span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span>Item text</p>' +
      '<p class="MsoListParagraph" style="mso-list:l3 level1 lfo5">' +
      '<span style="mso-list:Ignore">2.</span>Second</p>';
    const { docXml, pkg } = openFragment(html);
    expect(docXml).toContain('w:ilvl w:val="1"');
    expect(docXml).toContain('w:ilvl w:val="0"');
    expect(docXml).toContain('w:numId w:val="1001"');
    expect(docXml).toContain('Item text');
    expect(docXml).toContain('Second');
    // The literal "1." marker is Word furniture, not content.
    expect(docXml).not.toContain('>1.<');
    expect(docXml).not.toContain('>2.<');
    // The marker text sniffs as ordered.
    const numberingXml = strFromU8(pkg.partBytes.get('/word/numbering.xml')!);
    expect(numberingXml).toContain('w:numFmt w:val="decimal"');
  });

  test('Word lfo values allocate distinct instances of one list definition', () => {
    const item = (lfo: number, text: string): string =>
      `<p style="mso-list:l3 level1 lfo${lfo}">` +
      `<span style="mso-list:Ignore">1.</span>${text}</p>`;
    const { docXml } = openFragment(item(5, 'first') + item(6, 'restart'));
    expect(docXml).toContain('w:numId w:val="1001"');
    expect(docXml).toContain('w:numId w:val="1002"');
  });

  test('Word list markers preserve Roman, letter, and restarted decimal numbering', () => {
    const item = (id: number, marker: string, text: string): string =>
      `<p style="mso-list:l${id} level1 lfo${id}">` +
      `<span style="mso-list:Ignore">${marker}</span>${text}</p>`;
    const { pkg } = openFragment(
      item(4, 'I.', 'roman') +
        item(5, 'A.', 'upper letter') +
        item(6, 'a.', 'lower letter') +
        item(7, '5.', 'restart')
    );
    const numberingXml = strFromU8(pkg.partBytes.get('/word/numbering.xml')!);
    expect(numberingXml).toContain('w:numFmt w:val="upperRoman"');
    expect(numberingXml).toContain('w:numFmt w:val="upperLetter"');
    expect(numberingXml).toContain('w:numFmt w:val="lowerLetter"');
    expect(numberingXml).toContain('<w:start w:val="5"/>');
  });

  test('semantic ordered-list type and start attributes remain numbering properties', () => {
    const { pkg } = openFragment('<ol type="A" start="5"><li>item</li></ol>');
    const numberingXml = strFromU8(pkg.partBytes.get('/word/numbering.xml')!);
    expect(numberingXml).toContain('w:numFmt w:val="upperLetter"');
    expect(numberingXml).toContain('<w:start w:val="5"/>');
  });
});

describe('tables', () => {
  test('borders, colspan, shading and th styling project to table properties', () => {
    const { docXml } = openFragment(
      '<table border="1"><tr><th colspan="2" style="background:#ffff00;padding:4pt 6pt;' +
        'mso-border-alt:double #2B6CB0 1.5pt">head</th></tr>' +
        '<tr><td>b</td><td style="vertical-align:middle">c</td></tr></table>'
    );
    expect(docXml).toContain('<w:tbl>');
    expect(docXml).toContain('w:tblBorders');
    expect(docXml).toContain('w:gridSpan w:val="2"');
    expect(docXml).toContain('w:fill="FFFF00"');
    expect(docXml).toContain('w:vAlign w:val="center"');
    expect(docXml).toContain('<w:tcBorders>');
    expect(docXml).toContain('w:val="double"');
    expect(docXml).toContain('w:sz="12"');
    expect(docXml).toContain('w:color="2B6CB0"');
    expect(docXml).toContain('<w:tcMar>');
    expect(docXml).toContain('<w:top w:type="dxa" w:w="80"/>');
    expect(docXml).toContain('<w:left w:type="dxa" w:w="120"/>');
    // th → bold runs, centered paragraph.
    expect(docXml).toContain('<w:b/>');
    expect(docXml).toContain('w:jc w:val="center"');
    // Grid carries one w:gridCol per column.
    expect(docXml.split('<w:gridCol').length - 1).toBe(2);
  });

  test('Word table and cell widths define the fixed grid', () => {
    const { docXml } = openFragment(
      '<table align="center" style="width:3in"><tr style="height:18pt;mso-height-rule:exactly">' +
        '<td style="width:1in">narrow</td><td style="width:2in">wide</td>' +
        '</tr></table>'
    );
    expect(docXml).toContain('<w:tblW ');
    expect(docXml).toContain('w:w="4320"');
    expect(docXml).toContain('<w:jc w:val="center"/>');
    expect(docXml).toContain('<w:gridCol w:w="1440"/>');
    expect(docXml).toContain('<w:gridCol w:w="2880"/>');
    expect(docXml).toContain('<w:trHeight w:hRule="exact" w:val="360"/>');
    expect(docXml.match(/<w:tcW[^>]+w:w="1440"/g)).toHaveLength(1);
    expect(docXml.match(/<w:tcW[^>]+w:w="2880"/g)).toHaveLength(1);
  });

  test('Word floating table center position overrides its fallback left alignment', () => {
    const { docXml } = openFragment(
      '<table align="left" style="width:250pt;mso-table-anchor-horizontal:margin;' +
        'mso-table-anchor-vertical:paragraph;mso-table-left:center;mso-table-top:10pt">' +
        '<tr><td>centered fallback</td></tr></table>'
    );
    expect(docXml).toContain('<w:tblpPr ');
    expect(docXml).toContain('w:horzAnchor="margin"');
    expect(docXml).toContain('w:vertAnchor="text"');
    expect(docXml).toContain('w:tblpXSpec="center"');
    expect(docXml).toContain('w:tblpY="200"');
    expect(docXml).toContain('<w:jc w:val="center"/>');
  });

  test('Word table border styles and internal borders remain distinct', () => {
    const { docXml } = openFragment(
      '<table style="border:none;mso-border-alt:double #112233 1.5pt;' +
        'mso-border-insideh:.5pt dotted #445566;mso-border-insidev:1pt dashed #778899">' +
        '<tr><td>a</td><td>b</td></tr></table>'
    );
    const properties = docXml.split('</w:tblPr>')[0]!;
    expect(properties).toContain('<w:top ');
    expect(properties).toContain('w:val="double"');
    expect(properties).toContain('w:sz="12"');
    expect(properties).toContain('w:color="112233"');
    expect(properties).toContain('<w:insideH ');
    expect(properties).toContain('w:val="dotted"');
    expect(properties).toContain('w:color="445566"');
    expect(properties).toContain('<w:insideV ');
    expect(properties).toContain('w:val="dashed"');
    expect(properties).toContain('w:color="778899"');
  });

  test('rowspan becomes a vMerge restart plus continuation cells', () => {
    const { docXml } = openFragment(
      '<table><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></table>'
    );
    expect(docXml).toContain('w:vMerge w:val="restart"');
    expect(docXml).toContain('<w:vMerge/>');
  });

  test('a table without visible borders emits no tblBorders', () => {
    const { docXml } = openFragment('<table><tr><td>x</td></tr></table>');
    expect(docXml).not.toContain('w:tblBorders');
  });
});

describe('hyperlinks', () => {
  test('a javascript: href drops the link wrapper but keeps its text', () => {
    const { docXml, relsXml } = openFragment('<p><a href="javascript:alert(1)">click</a></p>');
    expect(docXml).not.toContain('w:hyperlink');
    expect(docXml).toContain('click');
    expect(docXml).not.toContain('w:color w:val="0563C1"');
    expect(docXml).not.toContain('<w:u ');
    expect(relsXml).not.toContain('javascript');
  });

  test('an empty href stays plain text', () => {
    const { docXml } = openFragment('<p><a href="">plain</a></p>');
    expect(docXml).not.toContain('w:hyperlink');
    expect(docXml).not.toContain('w:color w:val="0563C1"');
    expect(docXml).not.toContain('<w:u ');
  });

  test('an https href becomes an External hyperlink relationship', () => {
    const { docXml, relsXml } = openFragment('<p><a href="https://x.example/">go</a></p>');
    expect(docXml).toContain('<w:hyperlink');
    expect(docXml).toContain('go');
    expect(relsXml).toContain('relationships/hyperlink');
    expect(relsXml).toContain('Target="https://x.example/"');
    expect(relsXml).toContain('TargetMode="External"');
    // The Hyperlink CHARACTER STYLE, so the host theme controls the look.
    expect(docXml).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(docXml).not.toContain('<w:color w:val="0563C1"/>');
  });

  test('an explicit Word link span can override the default hyperlink appearance', () => {
    const { docXml } = openFragment(
      '<p><a href="#target"><span style="color:windowtext;text-decoration:none">TOC</span></a></p>'
    );
    expect(docXml).toContain('<w:hyperlink w:anchor="target">');
    expect(docXml).toContain('<w:color w:val="000000"/>');
    expect(docXml).not.toContain('<w:u w:val="single"/>');
  });

  test('Word bookmarks and same-document links remain internal', () => {
    const { docXml, relsXml } = openFragment(
      '<p><a name="_Ref1"></a>target <a href="#_Ref1">jump</a> ' +
        '<a href="#javascript:bad">unsafe</a></p>'
    );
    expect(docXml).toContain('<w:bookmarkStart ');
    expect(docXml).toContain('w:name="_Ref1"');
    expect(docXml).toContain('<w:bookmarkEnd ');
    expect(docXml).toContain('<w:hyperlink w:anchor="_Ref1">');
    expect(docXml).toContain('unsafe');
    expect(docXml).not.toContain('javascript:bad');
    expect(relsXml).not.toContain('Target="#_Ref1"');
  });
});

describe('notes', () => {
  test('Word footnote and endnote HTML becomes referenced note parts', () => {
    const { docXml, pkg, relsXml } = openFragment(
      '<p>See<a style="mso-footnote-id:ftn1" href="#_ftn1">' +
        '<span class="MsoFootnoteReference">[1]</span></a> and ' +
        '<a style="mso-endnote-id:edn2" href="#_edn2">[i]</a>.</p>' +
        '<div style="mso-element:footnote-list">' +
        '<div style="mso-element:footnote" id="ftn1"><p>' +
        '<a style="mso-footnote-id:ftn1" href="#_ftnref1">[1]</a>' +
        '<a href="https://notes.example/source">Source note.</a></p></div></div>' +
        '<div style="mso-element:endnote-list">' +
        '<div style="mso-element:endnote" id="edn2"><p>' +
        '<a style="mso-endnote-id:edn2" href="#_ednref2">[i]</a>End note.</p></div></div>'
    );
    expect(docXml).toContain('<w:footnoteReference w:id="1"/>');
    expect(docXml).toContain('<w:endnoteReference w:id="2"/>');
    expect(docXml).not.toContain('w:color w:val="0563C1"');
    expect(docXml).not.toContain('<w:u ');
    expect(docXml).not.toContain('Source note.');
    expect(docXml).not.toContain('End note.');
    expect(relsXml).toContain('relationships/footnotes');
    expect(relsXml).toContain('relationships/endnotes');
    const footnotes = strFromU8(pkg.partBytes.get('/word/footnotes.xml')!);
    const endnotes = strFromU8(pkg.partBytes.get('/word/endnotes.xml')!);
    expect(footnotes).toContain('<w:footnote w:id="1">');
    expect(footnotes).toContain('<w:footnoteRef/>');
    expect(footnotes).not.toContain('<w:footnoteReference ');
    expect(footnotes).toContain('Source note.');
    expect(footnotes).not.toContain('[1]');
    expect(endnotes).toContain('<w:endnote w:id="2">');
    expect(endnotes).toContain('<w:endnoteRef/>');
    expect(endnotes).not.toContain('<w:endnoteReference ');
    expect(endnotes).toContain('End note.');
    expect(endnotes).not.toContain('[i]');
    expect(relsXml).not.toContain('notes.example');
    const footnoteRels = strFromU8(pkg.partBytes.get('/word/_rels/footnotes.xml.rels')!);
    expect(footnoteRels).toContain('https://notes.example/source');
  });
});

describe('images', () => {
  test('an external image source is dropped with no artifact and no fetch', () => {
    const { docXml, pkg, relsXml } = openFragment(
      '<p>before<img src="https://remote.example/x.png">after</p>'
    );
    expect(docXml).not.toContain('w:drawing');
    expect(docXml).toContain('before');
    expect(docXml).toContain('after');
    expect(pkg.partBytes.get('/word/media/image1.png')).toBeUndefined();
    expect(relsXml).not.toContain('remote.example');
  });

  test('a data: PNG becomes a media part with an inline drawing', () => {
    const { docXml, pkg, relsXml } = openFragment(
      `<p><img src="data:image/png;base64,${TINY_PNG_BASE64}" width="10" height="20"></p>`
    );
    expect(docXml).toContain('w:drawing');
    expect(docXml).toContain('r:embed=');
    // 10px × 9525, 20px × 9525.
    expect(docXml).toContain('cx="95250"');
    expect(docXml).toContain('cy="190500"');
    const media = pkg.partBytes.get('/word/media/image1.png');
    expect(media).toBeDefined();
    expect(media!.length).toBeGreaterThan(8);
    expect(relsXml).toContain('Target="media/image1.png"');
  });

  test('data: raster, SVG, and preserved images become matching media parts', () => {
    const cases = [
      {
        mime: 'image/webp',
        extension: 'webp',
        bytes: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      },
      { mime: 'image/bmp', extension: 'bmp', bytes: [0x42, 0x4d] },
      { mime: 'image/svg+xml', extension: 'svg', bytes: [60, 115, 118, 103, 62] },
      {
        mime: 'image/x-emf',
        extension: 'emf',
        bytes: Array.from({ length: 44 }, (_, index) => (index === 0 ? 1 : 0)),
      },
    ] as const;
    for (const image of cases) {
      const base64 = btoa(Array.from(image.bytes, (byte) => String.fromCharCode(byte)).join(''));
      const { docXml, pkg } = openFragment(
        `<p><img src="data:${image.mime};base64,${base64}" width="10" height="20"></p>`
      );
      expect(docXml).toContain('w:drawing');
      expect(pkg.partBytes.get(`/word/media/image1.${image.extension}`)).toBeDefined();
    }
  });

  test('Word bare image dimensions use points', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><p>' +
      `<img src="data:image/png;base64,${TINY_PNG_BASE64}" width="10" height="20">` +
      '</p></body></html>';
    const { docXml } = openFragment(html);
    // 10pt and 20pt expressed as CSS pixels, then converted to EMU.
    expect(docXml).toContain('cx="127000"');
    expect(docXml).toContain('cy="254000"');
  });

  test('an unsized PNG uses its physical density', () => {
    const png = pngWithPhysicalSize(144, 72, 5669);
    const { docXml } = openFragment(`<p><img src="data:image/png;base64,${png}"></p>`);
    // Integer pixels-per-metre metadata is approximately 144 dpi.
    expect(docXml).toContain('cx="914447"');
    expect(docXml).toContain('cy="457223"');
  });

  test('a data: image above the per-image cap is dropped', () => {
    const projected = projectExternalHtml(
      `<p>kept<img src="data:image/png;base64,${TINY_PNG_BASE64}"></p>`,
      { maxImageBytes: 8 }
    );
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const read = readOoxmlPackage(projected.fragmentBytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.package.partBytes.get('/word/media/image1.png')).toBeUndefined();
  });

  test('sniffed image bytes override Word preview MIME labels', () => {
    const { docXml, pkg } = openFragment(
      `<p><img src="data:image/jpeg;base64,${TINY_PNG_BASE64}">` +
        `<img src="data:image/emf;base64,${TINY_PNG_BASE64}"></p>`
    );
    expect(docXml.match(/<w:drawing>/g)).toHaveLength(2);
    expect(pkg.partBytes.get('/word/media/image1.png')).toBeDefined();
    expect(pkg.partBytes.get('/word/media/image2.png')).toBeDefined();
    expect(pkg.partBytes.get('/word/media/image1.jpeg')).toBeUndefined();
  });

  test('a recognized image signature with an unparseable header keeps fallback extents', () => {
    const { docXml, pkg } = openFragment('<p><img src="data:image/jpeg;base64,/9j/"></p>');
    expect(docXml).toContain('<wp:extent cx="3810000" cy="2540000"/>');
    expect(pkg.partBytes.get('/word/media/image1.jpeg')).toBeDefined();
  });
});

describe('caps and refusals', () => {
  test('html above maxHtmlBytes refuses before parse', () => {
    expect(projectExternalHtml('<p>hello</p>', { maxHtmlBytes: 4 })).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  test('the node cap truncates instead of throwing', () => {
    const html = Array.from({ length: 50 }, (_, i) => `<p>block${i}</p>`).join('');
    const projected = projectExternalHtml(html, { maxNodes: 10 });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const read = readOoxmlPackage(projected.fragmentBytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const docXml = strFromU8(read.package.partBytes.get('/word/document.xml')!);
    expect(docXml).toContain('block0');
    expect(docXml).not.toContain('block49');
  });

  test('empty and content-free payloads refuse as no-content', () => {
    expect(projectExternalHtml('')).toEqual({ ok: false, reason: 'no-content' });
    expect(projectExternalHtml('<script>evil()</script>')).toEqual({
      ok: false,
      reason: 'no-content',
    });
  });

  test('a missing DOMParser refuses as parse-unavailable', () => {
    const scope = globalThis as { DOMParser?: unknown };
    const original = scope.DOMParser;
    scope.DOMParser = undefined;
    try {
      expect(projectExternalHtml('<p>x</p>')).toEqual({
        ok: false,
        reason: 'parse-unavailable',
      });
    } finally {
      scope.DOMParser = original;
    }
  });
});

describe('hostile payloads stay inert', () => {
  test('script, style and event handlers leave no artifacts', () => {
    const { docXml } = openFragment(
      '<script>window.evil = true;</script><style>p { color: red; }</style>' +
        '<p onclick="steal()" onmouseover="steal()">safe</p>' +
        '<iframe src="https://evil.example/"></iframe><template><p>hidden</p></template>'
    );
    expect(docXml).toContain('safe');
    expect(docXml).not.toContain('evil');
    expect(docXml).not.toContain('steal');
    expect(docXml).not.toContain('onclick');
    expect(docXml).not.toContain('color: red');
  });
});

describe('whitespace and breaks', () => {
  test('whitespace runs collapse to single spaces outside pre', () => {
    const { docXml } = openFragment('<p>alpha\n   beta\t\tgamma</p>');
    expect(docXml).toContain('alpha beta gamma');
  });

  test('br becomes w:br', () => {
    const { docXml } = openFragment('<p>one<br>two</p>');
    expect(docXml).toContain('<w:br/>');
  });

  test('Word top-level page-break and spacer become pageBreakBefore on the next paragraph', () => {
    const { docXml } = openFragment(
      "<p>before</p><span><br clear=all style='mso-special-character:line-break;" +
        "page-break-before:always;mso-break-type:section-break'></span>" +
        '<p><o:p>&nbsp;</o:p></p><h1>after</h1>'
    );
    expect(docXml).toContain('<w:pageBreakBefore/>');
    expect(docXml).not.toContain('<w:br w:type="page"/>');
    expect(docXml.match(/<w:p>/g)).toHaveLength(2);
  });

  test('a page-break br inside a paragraph remains a typed run break', () => {
    const { docXml } = openFragment("<p>before<br style='page-break-before:always'>after</p>");
    expect(docXml).toContain('<w:br w:type="page"/>');
  });

  test('a nested page break remains pending for the next outer paragraph', () => {
    const { docXml } = openFragment(
      "<section><br style='page-break-before:always'></section><p>after</p>"
    );
    expect(docXml).toContain('<w:pageBreakBefore/>');
  });

  test('a page break applies to a following list and remains before a following table', () => {
    const list = openFragment("<br style='page-break-before:always'><ol><li>item</li></ol>");
    expect(list.docXml).toContain('<w:pageBreakBefore/>');
    expect(list.docXml).toContain('<w:numPr>');
    const table = openFragment(
      "<p>before</p><br style='page-break-before:always'><table><tr><td>cell</td></tr></table>"
    );
    expect(table.docXml.split('<w:tbl>')[0]).toContain('<w:br w:type="page"/>');
    expect(table.docXml).toContain('<w:tbl>');
  });

  test('an empty list does not consume a pending or trailing page break', () => {
    const followed = openFragment("<br style='page-break-before:always'><ol></ol><p>after</p>");
    expect(followed.docXml).toContain('<w:pageBreakBefore/>');
    const trailing = openFragment("<p>before</p><br style='page-break-before:always'>");
    expect(trailing.docXml).toContain('<w:br w:type="page"/>');
  });

  test('only Word office-space paragraphs are removed after page breaks', () => {
    const { docXml } = openFragment(
      "<br style='page-break-before:always'>" +
        '<p><a name="_Keep"></a></p><p style="text-align:center"></p><p>after</p>'
    );
    expect(docXml).toContain('w:name="_Keep"');
    expect(docXml).toContain('<w:jc w:val="center"/>');
    expect(docXml).toContain('after');
  });

  test('inline Word checkbox SDTs do not split their host paragraphs', () => {
    const { docXml } = openFragment(
      '<p><w:Sdt CheckBox="t"><span>☒</span></w:Sdt> Task completed</p>'
    );
    expect(docXml.match(/<w:p>/g)).toHaveLength(1);
    expect(docXml).toContain('☒');
    expect(docXml).toContain(' Task completed');
  });

  test('Word tab count and positional tab markup remain semantic tabs', () => {
    const { docXml } = openFragment(
      '<p style="tab-stops:right 451.3pt"><b>Left</b>' +
        "<span style='mso-tab-count:1'> </span>Right</p>" +
        '<p>Contents<w:PTab Alignment="RIGHT" RelativeTo="MARGIN" Leader="DOT"></w:PTab>4</p>'
    );
    expect(docXml).toContain('<w:tabs><w:tab ');
    expect(docXml).toContain('w:val="right"');
    expect(docXml).toContain('w:pos="9026"');
    expect(docXml).toContain('<w:tab/>');
    expect(docXml).toContain('<w:ptab ');
    expect(docXml).toContain('w:alignment="right"');
    expect(docXml).toContain('w:relativeTo="margin"');
    expect(docXml).toContain('w:leader="dot"');
  });

  test('Word TOC wrappers keep rows while comment and note chrome stays out', () => {
    const { docXml, pkg } = openFragment(
      '<w:Sdt><w:SdtPr></w:SdtPr><p>first<w:PTab Alignment="RIGHT" ' +
        'RelativeTo="MARGIN" Leader="DOT"></w:PTab></p><p>second</p></w:Sdt>' +
        '<p>body<a style="mso-footnote-id:ftn1" href="#_ftn1">[1]</a></p>' +
        '<a class="msocomanchor" style="mso-element:comment-reference">[1]</a>' +
        '<div style="mso-element:footnote-list"><div style="mso-element:footnote" id="ftn1">' +
        '<p>note body</p></div></div>'
    );
    expect(docXml.match(/<w:p>/g)).toHaveLength(3);
    expect(docXml).toContain('first');
    expect(docXml).toContain('second');
    expect(docXml).toContain('<w:ptab ');
    expect(docXml).toContain('<w:footnoteReference w:id="1"/>');
    expect(docXml).not.toContain('[1]');
    // The referenced definition re-emits only through the footnotes part.
    expect(docXml).not.toContain('note body');
    expect(pkg.partBytes.get('/word/footnotes.xml')).toBeDefined();
  });

  test('a note definition the collector cannot claim projects losslessly into the body', () => {
    const { docXml } = openFragment(
      '<p>body</p><div style="mso-element:footnote-list">' +
        '<div style="mso-element:footnote"><p>orphan note text</p></div></div>'
    );
    expect(docXml).toContain('orphan note text');
  });

  test('a wrapped block SDT keeps its child paragraphs separate', () => {
    const { docXml } = openFragment(
      '<w:Sdt><span><section><p>first</p><p>second</p></section></span></w:Sdt>'
    );
    expect(docXml.match(/<w:p>/g)).toHaveLength(2);
  });

  test('pre preserves whitespace, converts newlines to w:br and uses Courier New', () => {
    const { docXml } = openFragment('<pre>line1\n  line2</pre>');
    expect(docXml).toContain('<w:br/>');
    expect(docXml).toContain('  line2');
    expect(docXml).toContain('w:ascii="Courier New"');
  });

  test('whitespace-only text between blocks does not become a paragraph', () => {
    const { docXml } = openFragment('<p>a</p>\n   \n<p>b</p>');
    expect(docXml.split('<w:p>').length - 1).toBe(2);
  });
});
