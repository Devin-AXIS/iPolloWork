// What `renderedFontFamilies()` — the substitution notice's input — reports.
//
// The contract under test: a family joins the answer only when RENDERED text resolves to
// it through the style cascade. A declaration in a style no paragraph references (Word's
// latent Balloon Text naming Segoe UI, a table style carrying a face name) contributes to
// `documentFonts()` for the picker, and never here. The cascade half: used `w:pStyle` /
// `w:rStyle` / `w:tblStyle` chains resolve through `basedOn` with the nearest family
// winning, absent paragraph and table references fall to the `w:default="1"` style of
// the type, the default character style contributes nothing, and `w:docDefaults` counts
// once any text renders.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { collectRenderedFontFamilies } from '../document-rendered-fonts.ts';
import { openTreeSession, type TreeDocxSession } from '../tree-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx(options: { body: string; styles?: string; header?: string }): Uint8Array {
  const { body, styles, header } = options;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        (header
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}">` +
        `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  const documentRels: string[] = [];
  if (styles) {
    files['word/styles.xml'] = strToU8(styles);
    documentRels.push(`<Relationship Id="rId10" Type="${STYLES_REL}" Target="styles.xml"/>`);
  }
  if (header) {
    files['word/header1.xml'] = strToU8(header);
    documentRels.push(`<Relationship Id="rId11" Type="${HEADER_REL}" Target="header1.xml"/>`);
  }
  if (documentRels.length > 0) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL_NS}">${documentRels.join('')}</Relationships>`
    );
  }
  return zipSync(files);
}

function open(bytes: Uint8Array): TreeDocxSession {
  const result = openTreeSession(bytes);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.session;
}

const run = (font: string, text: string) =>
  `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr><w:t>${text}</w:t></w:r>`;

const styles = (body: string) => `<w:styles xmlns:w="${W}">${body}</w:styles>`;

const styleWithFont = (type: string, id: string, font: string) =>
  `<w:style w:type="${type}" w:styleId="${id}">` +
  `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr></w:style>`;

describe('collectRenderedFontFamilies', () => {
  test('a declaration in an unused style is not rendered', () => {
    // The false-positive shape from real Word files: latent Balloon Text names Segoe UI,
    // an unused table style carries a face name as a family; no paragraph uses either.
    const session = open(
      docx({
        body: `<w:p>${run('Garamond', 'body text')}</w:p>`,
        styles: styles(
          styleWithFont('paragraph', 'BalloonText', 'Segoe UI') +
            styleWithFont('table', 'TableGrid1', 'Times New Roman Bold')
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Garamond']);
    // The picker still sees every declaration — the two answers ask different questions.
    expect(session.documentFonts()).toEqual(['Garamond', 'Segoe UI', 'Times New Roman Bold']);
  });

  test('the eastAsia face renders only when the run carries East Asian text', () => {
    // CJK-locale Office builds stamp w:eastAsia on nearly every run. A Latin-only run
    // resolves no glyph through it, so reporting it rendered raises a false missing-font
    // notice and burns a resolver slot.
    const latinOnly = open(
      docx({
        body: '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond" w:eastAsia="DengXian"/></w:rPr><w:t>Latin</w:t></w:r></w:p>',
      })
    );
    expect(latinOnly.renderedFontFamilies()).toEqual(['Garamond']);

    const cjk = open(
      docx({
        body: '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond" w:eastAsia="DengXian"/></w:rPr><w:t>漢字</w:t></w:r></w:p>',
      })
    );
    expect(cjk.renderedFontFamilies()).toEqual(['DengXian', 'Garamond']);
  });

  test('a distinct hAnsi face renders only when the run has non-ASCII text it draws', () => {
    const fonts = '<w:rFonts w:ascii="Garamond" w:hAnsi="Tahoma"/>';
    const text = (value: string) =>
      open(docx({ body: `<w:p><w:r><w:rPr>${fonts}</w:rPr><w:t>${value}</w:t></w:r></w:p>` }))
        .renderedFontFamilies()
        .slice();
    expect(text('Latin')).toEqual(['Garamond']);
    expect(text('Café')).toEqual(['Garamond', 'Tahoma']);
    // The no-break space advances in the hAnsi face; Hebrew is not drawn through it.
    expect(text('1 2')).toEqual(['Garamond', 'Tahoma']);
    expect(text('1 ש')).toEqual(['Garamond']);

    // The slot inherits on its own: a nearer ascii-only rFonts does not hide a style's hAnsi.
    const inherited = open(
      docx({
        body:
          '<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:rPr>' +
          '<w:rFonts w:ascii="Garamond"/></w:rPr><w:t>über</w:t></w:r></w:p>',
        styles: styles(
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>' +
            '</w:rPr></w:rPrDefault></w:docDefaults>' +
            '<w:style w:type="paragraph" w:styleId="Body">' +
            '<w:rPr><w:rFonts w:hAnsi="Tahoma"/></w:rPr></w:style>'
        ),
      })
    );
    expect(inherited.renderedFontFamilies()).toEqual(['Garamond', 'Tahoma']);
  });

  test('slots no level names report the format default faces under an authored rPrDefault', () => {
    const formatDefaults = styles(
      '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>'
    );
    const families = (text: string) =>
      open(
        docx({
          body: `<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`,
          styles: formatDefaults,
        })
      )
        .renderedFontFamilies()
        .slice();
    expect(families('Latin')).toEqual(['Garamond']);
    expect(families('Café')).toEqual(['Garamond', 'Times New Roman']);
    expect(families('漢字')).toEqual(['Garamond', 'SimSun']);
    // Full-width forms draw in the East Asian face.
    expect(families('Ａ１')).toEqual(['Garamond', 'SimSun']);
  });

  test('a run hinted East Asian reports its East Asian face for hinted Latin-1 text', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond" w:eastAsia="DengXian" ' +
          'w:hint="eastAsia"/></w:rPr><w:t>§ é</w:t></w:r></w:p>',
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['DengXian', 'Garamond']);
  });

  test('a hint and East Asian face from a paragraph style report that face too', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:pPr><w:pStyle w:val="Hinted"/></w:pPr><w:r><w:rPr>' +
          '<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/></w:rPr><w:t>§</w:t></w:r></w:p>',
        styles: styles(
          '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
            '<w:style w:type="paragraph" w:styleId="Hinted"><w:rPr>' +
            '<w:rFonts w:eastAsia="DengXian" w:hint="eastAsia"/></w:rPr></w:style>'
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['DengXian', 'Garamond']);
  });

  test('a w:sym face is not a rendered text face', () => {
    // Word writes `w:sym w:font="MS Gothic"` for a checkbox and `Wingdings` for a bullet.
    // A symbol face paints one glyph, moves no text metrics, and is not a family the picker
    // offers or the editor asks a resolver for — so the substitution notice, which reports
    // faces an app could have supplied, must not name it. The run's own face still counts:
    // it is what the surrounding text renders in.
    const session = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond"/></w:rPr>' +
          '<w:sym w:font="MS Gothic" w:char="2612"/><w:t>checked</w:t></w:r></w:p>',
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Garamond']);

    // Word's own checkbox shape, which `applySetContentControlValue` also mints when the
    // user ticks a box: the symbol face is repeated on the RUN. Nothing paints in it —
    // `symbolRunStyle` overrides `rFonts` with `w:sym/@w:font` — so it must not come back
    // into the answer through the run.
    const wordCheckbox = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" ' +
          'w:hAnsi="MS Gothic"/></w:rPr><w:sym w:font="MS Gothic" w:char="2612"/></w:r>' +
          '<w:r><w:rPr><w:rFonts w:ascii="Garamond"/></w:rPr><w:t>Task done</w:t></w:r></w:p>',
      })
    );
    expect(wordCheckbox.renderedFontFamilies()).toEqual(['Garamond']);

    // A `w:sym` naming no face of its own DOES paint in the run's face, so that one counts.
    const runFaced = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond"/></w:rPr>' +
          '<w:sym w:char="2612"/></w:r></w:p>',
      })
    );
    expect(runFaced.renderedFontFamilies()).toEqual(['Garamond']);

    // Layout applies any `@w:font` within its length bound, including a name no CSS sink
    // would take — Word's vertical-writing `@` prefix is the everyday one. The override is
    // real, so the run's own face still paints nothing.
    const verticalWriting = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="MS Gothic"/></w:rPr>' +
          '<w:sym w:font="@MS Gothic" w:char="2612"/></w:r></w:p>',
      })
    );
    expect(verticalWriting.renderedFontFamilies()).toEqual([]);
    // And no resolver is asked for `@MS Gothic`: the measurer and the paint sink both
    // reject that name, so bytes supplied under it could never reach the glyph.
    expect(verticalWriting.symbolFontFamilies()).toEqual([]);

    // A `font` in a foreign namespace is one layout ignores, so the run keeps its own face
    // and this answer must keep reporting it.
    const foreignNamespace = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond"/></w:rPr>' +
          '<w:sym xmlns:x="urn:x" x:font="Wingdings" w:char="2612"/></w:r></w:p>',
      })
    );
    expect(foreignNamespace.renderedFontFamilies()).toEqual(['Garamond']);

    // A face named BOTH by a symbol and by rendered text stays reported.
    const alsoText = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="MS Gothic"/></w:rPr>' +
          '<w:sym w:font="MS Gothic" w:char="2612"/><w:t>checked</w:t></w:r></w:p>',
      })
    );
    expect(alsoText.renderedFontFamilies()).toEqual(['MS Gothic']);
  });

  test('a w:sym face is its own answer: not the picker, not the notice, but the resolver', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond"/></w:rPr>' +
          '<w:sym w:font="Wingdings" w:char="F0A8"/><w:t>bullet</w:t></w:r></w:p>',
      })
    );
    // Applying Wingdings to a selection would set text in a dingbat face, so the picker
    // never offers it — but a resolver has to hear about it, or nothing can supply the face
    // an unmapped private-use glyph needs.
    expect(session.documentFonts()).toEqual(['Garamond']);
    expect(session.renderedFontFamilies()).toEqual(['Garamond']);
    expect(session.symbolFontFamilies()).toEqual(['Wingdings']);
  });

  test('symbol faces fold case-insensitively, keeping the first spelling a reader sees', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:r><w:sym w:font="Wingdings" w:char="F0A8"/><w:t>one</w:t></w:r></w:p>' +
          '<w:p><w:r><w:sym w:font="WINGDINGS" w:char="F0A7"/><w:t>two</w:t></w:r></w:p>',
      })
    );
    expect(session.symbolFontFamilies()).toEqual(['Wingdings']);
  });

  test('a run without text contributes nothing; an empty document answers []', () => {
    const empty = open(docx({ body: '<w:p/>' }));
    expect(empty.renderedFontFamilies()).toEqual([]);

    const declared = open(
      docx({ body: '<w:p><w:r><w:rPr><w:rFonts w:ascii="Impact"/></w:rPr></w:r></w:p>' })
    );
    expect(declared.renderedFontFamilies()).toEqual([]);
  });

  test('a run with direct w:vanish renders nothing; w:val="0" keeps it shown', () => {
    const hidden = (font: string, value = '') =>
      `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:vanish${value}/></w:rPr>` +
      '<w:t>hidden</w:t></w:r>';
    const session = open(
      docx({
        body:
          `<w:p>${run('Georgia', 'shown')}${hidden('Impact')}` +
          `${hidden('Verdana', ' w:val="0"')}</w:p>`,
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Georgia', 'Verdana']);
  });

  test('a used paragraph style resolves through basedOn, nearest family wins', () => {
    const session = open(
      docx({
        body:
          `<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>text</w:t></w:r></w:p>` +
          `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>quoted</w:t></w:r></w:p>`,
        styles: styles(
          // Body inherits its face from Base — the chain must be walked.
          `<w:style w:type="paragraph" w:styleId="Body"><w:basedOn w:val="Base"/></w:style>` +
            styleWithFont('paragraph', 'Base', 'Georgia') +
            // Quote SHADOWS Base's face: only the nearest family renders.
            `<w:style w:type="paragraph" w:styleId="Quote"><w:basedOn w:val="Base"/>` +
            '<w:rPr><w:rFonts w:ascii="Palatino" w:hAnsi="Palatino"/></w:rPr></w:style>' +
            // Declared and unused: excluded.
            styleWithFont('paragraph', 'Unused', 'Segoe UI')
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Georgia', 'Palatino']);
  });

  test('a used character style counts; docDefaults count once text renders', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>bold-ish</w:t></w:r>' +
          '<w:r><w:t>plain</w:t></w:r></w:p>',
        styles: styles(
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/></w:rPr></w:rPrDefault></w:docDefaults>' +
            styleWithFont('character', 'Strong', 'Georgia')
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Cambria', 'Georgia']);
  });

  test('absent style references fall to the w:default="1" paragraph style', () => {
    const session = open(
      docx({
        body: '<w:p><w:r><w:t>bare</w:t></w:r></w:p>',
        styles: styles(
          `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
            '<w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/></w:rPr></w:style>' +
            `<w:style w:type="character" w:default="1" w:styleId="DPF">` +
            '<w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:style>'
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Aptos']);
  });

  test('the default character style face never renders, named or reached through basedOn', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rStyle w:val="DPF"/></w:rPr><w:t>named</w:t></w:r>' +
          '<w:r><w:rPr><w:rStyle w:val="Child"/></w:rPr><w:t>derived</w:t></w:r></w:p>',
        styles: styles(
          `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
            '<w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/></w:rPr></w:style>' +
            `<w:style w:type="character" w:default="1" w:styleId="DPF">` +
            '<w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:style>' +
            `<w:style w:type="character" w:styleId="Child"><w:basedOn w:val="DPF"/>` +
            '<w:rPr><w:b/></w:rPr></w:style>'
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Aptos']);
  });

  test('a text-bearing table brings its tblStyle chain and conditional formats', () => {
    const table = (styleRef: string) =>
      `<w:tbl>${styleRef}<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const session = open(
      docx({
        body: table('<w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr>'),
        styles: styles(
          `<w:style w:type="table" w:styleId="Grid">` +
            '<w:rPr><w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/></w:rPr>' +
            '<w:tblStylePr w:type="firstRow"><w:rPr><w:rFonts w:ascii="Impact"/></w:rPr></w:tblStylePr>' +
            '</w:style>' +
            styleWithFont('table', 'UnusedGrid', 'Segoe UI')
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Impact', 'Verdana']);
  });

  test('theme slot references resolve to the theme faces', () => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr>` +
        '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>' +
        '</w:rPr><w:t>themed</w:t></w:r></w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    expect(
      collectRenderedFontFamilies([result.part.root], null, {
        major: 'Aptos Display',
        minor: 'Aptos',
      })
    ).toEqual(['Aptos']);
    // Without theme faces the reference contributes nothing.
    expect(
      collectRenderedFontFamilies([result.part.root], null, { major: null, minor: null })
    ).toEqual([]);
  });

  test('text in a referenced header counts', () => {
    const session = open(
      docx({
        body: `<w:p/><w:sectPr><w:headerReference xmlns:r="${R}" w:type="default" r:id="rId11"/></w:sectPr>`,
        header: `<w:hdr xmlns:w="${W}"><w:p>${run('Impact', 'head')}</w:p></w:hdr>`,
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Impact']);
  });

  test('memoized per revision; the first typed character moves the answer', () => {
    const session = open(
      docx({
        body: '<w:p/>',
        styles: styles(
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults>'
        ),
      })
    );
    const first = session.renderedFontFamilies();
    expect(first).toEqual([]);
    expect(session.renderedFontFamilies()).toBe(first);
    const [paragraphId] = session.paragraphIds();
    const applied = session.applyTreeOps([
      { op: 'insertText', paragraphId: paragraphId!, offset: 0, text: 'Z' },
    ]);
    expect(applied.committed).toBe(true);
    expect(session.renderedFontFamilies()).toEqual(['Calibri']);
  });

  test('hostile names never reach the catalog: they render in the unmatched face', () => {
    const long = 'A'.repeat(500);
    const session = open(
      docx({
        body: `<w:p>${run(long, 'a')}${run('Bad&#x09;Name', 'b')}${run('Calibri', 'c')}</w:p>`,
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Calibri', 'Cambria']);
  });

  test('a quoted CSS-style list renders in the unmatched face, a plain list in its first item', () => {
    const session = open(
      docx({
        body:
          `<w:p>${run('&quot;Open Sans&quot;, sans-serif', 'a')}` +
          `${run('Verdana, Geneva, sans-serif', 'b')}</w:p>`,
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Cambria', 'Verdana']);
  });

  test('a glyph mark without w:t still counts its run: note marks render in a face', () => {
    // A footnote reference mark's run carries rFonts (or an rStyle chain) and no w:t.
    // The mark visibly renders, so its families must not vanish from the notice.
    const session = open(
      docx({
        body:
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Marker Face" w:hAnsi="Marker Face"/>' +
          '<w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r></w:p>',
        styles: styles(styleWithFont('character', 'FootnoteReference', 'Georgia')),
      })
    );
    // The run's own face is nearer than its character style, so Georgia draws nothing.
    expect(session.renderedFontFamilies()).toEqual(['Marker Face']);
  });

  test('a duplicated styleId resolves to the LAST definition, matching layout', () => {
    const session = open(
      docx({
        body: `<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>text</w:t></w:r></w:p>`,
        styles: styles(
          styleWithFont('paragraph', 'Body', 'FontA') + styleWithFont('paragraph', 'Body', 'FontB')
        ),
      })
    );
    // Layout's `buildStyleCascadeTable` paints from the last duplicate; the notice must
    // check the same definition.
    expect(session.renderedFontFamilies()).toEqual(['FontB']);
  });

  test('a later duplicate without w:default clears the default claim', () => {
    const session = open(
      docx({
        body: '<w:p><w:r><w:t>bare</w:t></w:r></w:p>',
        styles: styles(
          `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
            '<w:rPr><w:rFonts w:ascii="FontA"/></w:rPr></w:style>' +
            styleWithFont('paragraph', 'Normal', 'FontB')
        ),
      })
    );
    // No default paragraph style remains, so the bare paragraph resolves to docDefaults
    // alone (which name nothing here) — the same answer layout gives.
    expect(session.renderedFontFamilies()).toEqual([]);
  });

  test('a bare w:t outside any run never counts, whatever the child count', () => {
    // Invalid-but-parseable shape: a paragraph holding a stray w:t not wrapped in a run.
    // Layout paints runs, so neither the narrow nor the wide (compose-path) paragraph may
    // count it — the two walk paths must give one answer.
    const stray = '<w:pPr><w:pStyle w:val="X"/></w:pPr><w:t>stray</w:t>';
    const padding = '<w:bookmarkStart w:id="1" w:name="b"/>'.repeat(20);
    const narrow = open(
      docx({
        body: `<w:p>${stray}</w:p><w:p>${run('Garamond', 'real')}</w:p>`,
        styles: styles(styleWithFont('paragraph', 'X', 'Segoe UI')),
      })
    );
    const wide = open(
      docx({
        body: `<w:p>${stray}${padding}</w:p><w:p>${run('Garamond', 'real')}</w:p>`,
        styles: styles(styleWithFont('paragraph', 'X', 'Segoe UI')),
      })
    );
    expect(narrow.renderedFontFamilies()).toEqual(['Garamond']);
    expect(wide.renderedFontFamilies()).toEqual(narrow.renderedFontFamilies());
  });

  test('a basedOn cycle terminates and still answers', () => {
    const session = open(
      docx({
        body: `<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>text</w:t></w:r></w:p>`,
        styles: styles(
          `<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style>` +
            `<w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/>` +
            '<w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr></w:style>'
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Georgia']);
  });

  test('a family a nearer level overrides is not reported', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' +
          run('Calibri', 'Heading in body face') +
          '</w:p>',
        styles: styles(
          styleWithFont('paragraph', 'Heading1', 'Calibri Light') +
            `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:rPrDefault></w:docDefaults>`
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Calibri']);
  });

  test('a style face reaches runs with no face of their own, nearest level first', () => {
    const session = open(
      docx({
        body:
          '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>quoted</w:t></w:r></w:p>' +
          '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tr><w:tc>' +
          '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        styles: styles(
          styleWithFont('paragraph', 'Quote', 'Georgia') +
            styleWithFont('table', 'Grid', 'Verdana') +
            // A default paragraph style with no face lets the table's face through.
            `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"/>`
        ),
      })
    );
    expect(session.renderedFontFamilies()).toEqual(['Georgia', 'Verdana']);
  });

  test('East Asian faces count only for text with East Asian characters', () => {
    const eastAsianStyles = styles(
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="MS Mincho"/></w:rPr></w:rPrDefault></w:docDefaults>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:rFonts w:eastAsia="Yu Gothic Light"/></w:rPr></w:style>`
    );
    const latin = open(
      docx({
        body:
          '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Latin only</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:rFonts w:eastAsia="Yu Mincho"/></w:rPr><w:t>Body</w:t></w:r></w:p>',
        styles: eastAsianStyles,
      })
    );
    expect(latin.renderedFontFamilies()).toEqual(['Calibri']);
    const mixed = open(
      docx({
        body:
          '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>見出し</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>本文</w:t></w:r></w:p>',
        styles: eastAsianStyles,
      })
    );
    expect(mixed.renderedFontFamilies()).toEqual(['Calibri', 'MS Mincho', 'Yu Gothic Light']);
  });
});
