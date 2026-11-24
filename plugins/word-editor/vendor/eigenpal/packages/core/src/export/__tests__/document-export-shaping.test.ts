import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { defineFontResolver, type FontResolutionRequest } from '../../editor/index.ts';
import { sha256FontBytes } from '../../layout/index.ts';
import {
  ExportResourceError,
  openDocumentForExport as openCoreDocumentForExport,
} from '../export-session.ts';
import {
  acquireDocumentExportShaping,
  openFontBackedDocumentForExport,
} from '../document-export-shaping.ts';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const fontBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);

function fontFragment(family = 'DejaVu Sans', id = family) {
  return {
    sources: [
      {
        request: { family, weight: 400, style: 'normal' as const },
        id: `test:${id}`,
        bytes: fontBytes,
        hash: sha256FontBytes(fontBytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family, sizeHalfPoints: 22 },
  };
}

function completeFontFragment(family = 'DejaVu Sans') {
  return {
    sources: [
      { weight: 400, style: 'normal' as const },
      { weight: 700, style: 'normal' as const },
      { weight: 400, style: 'italic' as const },
      { weight: 700, style: 'italic' as const },
    ].map((face) => ({
      request: { family, ...face },
      id: `test:${family}:${face.weight}:${face.style}`,
      bytes: fontBytes,
      hash: sha256FontBytes(fontBytes),
      faceIndex: 0,
    })),
    defaultFont: { family, sizeHalfPoints: 22 },
  };
}

function fontCatalogDocx(): Uint8Array {
  const orphanRuns = Array.from(
    { length: 80 },
    (_, index) => `<w:r><w:rPr><w:rFonts w:ascii="Orphan Note ${index}"/></w:rPr><w:t>x</w:t></w:r>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="numbering" Type="${R}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="header" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="notes" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="${M}"><w:body>` +
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="Body Face"/></w:rPr><w:t>Body</w:t><w:sym w:font="Symbol Face" w:char="F0B7"/><w:footnoteReference w:id="1"/></w:r></w:p>' +
        // The eastAsia face only counts as rendered when the run carries East Asian text.
        '<w:p><w:r><w:rPr><w:rFonts w:eastAsia="CJK Face"/></w:rPr><w:t>漢</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="S"/></w:pPr><w:bookmarkStart w:id="1" w:name="Target"/><w:r><w:t>Styled</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Listed</w:t></w:r></w:p>' +
        '<w:p><w:r><w:drawing><w:txbxContent><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Box Text"/></w:rPr><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="SymbolStyle"/></w:pPr><w:fldSimple w:instr=" SYMBOL 183 "/></w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Field Face"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="AutoStyle"/></w:pPr><w:fldSimple w:instr=" AUTONUM "/></w:p>' +
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="Autonum Marker"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText> AUTONUM </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> MACROBUTTON SafeMacro Display </w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Button Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> MACROBUTTON SafeMacro SoftDisplay </w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Soft Cache Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Soft Cache Face"/></w:rPr><w:softHyphen/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="Checkbox Marker"/></w:rPr><w:fldChar w:fldCharType="begin"><w:ffData><w:checkBox><w:checked/></w:checkBox></w:ffData></w:fldChar><w:instrText> FORMCHECKBOX </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="S"><w:rPr><w:rFonts w:ascii="Style Face"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="SymbolStyle"><w:rPr><w:rFonts w:ascii="Symbol Style Face"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="AutoStyle"><w:rPr><w:rFonts w:ascii="Simple Auto Face"/></w:rPr></w:style></w:styles>`
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:rPr><w:rFonts w:ascii="Marker Face"/></w:rPr></w:lvl></w:abstractNum>' +
        '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:rPr><w:rFonts w:ascii="Box Marker Face"/></w:rPr></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>' +
        '</w:numbering>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:rPr><w:rFonts w:ascii="Header Face"/></w:rPr><w:t>Header</w:t></w:r></w:p>` +
        '<w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Header Textbox Page"/></w:rPr><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p></w:hdr>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Note Face"/></w:rPr><w:t>Note</w:t></w:r></w:p>` +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> REF Target </w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Note Ref Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:del w:id="7" w:author="Reviewer"><w:r><w:t>Styled</w:t></w:r></w:del><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="Note Auto Marker"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText> AUTONUM </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Note Page Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGEREF Target </w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Note PageRef Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="2"><w:p>${orphanRuns}</w:p></w:footnote></w:footnotes>`
    ),
  });
}

function priorityDocx(): Uint8Array {
  const headerRuns = Array.from(
    { length: 80 },
    (_, index) =>
      `<w:r><w:rPr><w:rFonts w:ascii="Header Flood ${index}"/></w:rPr><w:t>x</w:t></w:r>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="header" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="BodyStyle"/></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="BodyStyle"><w:rPr><w:rFonts w:ascii="Body Priority Face"/></w:rPr></w:style></w:styles>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}"><w:p>${headerRuns}</w:p></w:hdr>`),
  });
}

function minimalDocx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function fieldFloodDocx(): Uint8Array {
  const cached = Array.from(
    { length: 22 },
    (_, index) =>
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Begin ${index}"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>` +
      `<w:r><w:rPr><w:rFonts w:ascii="Separate ${index}"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>` +
      '<w:r><w:rPr><w:rFonts w:ascii="Cached Face"/></w:rPr><w:t>1</w:t></w:r>' +
      `<w:r><w:rPr><w:rFonts w:ascii="End ${index}"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p>`
  ).join('');
  const inert = Array.from(
    { length: 65 },
    (_, index) =>
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Inert ${index}"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r></w:p>`
  ).join('');
  const malformedPages = Array.from(
    { length: 65 },
    (_, index) =>
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Malformed Page ${index}"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>`
  ).join('');
  return minimalDocx(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Body Face"/></w:rPr><w:t>body</w:t></w:r></w:p>' +
      cached +
      inert +
      malformedPages
  );
}

test('the public export opener requests run, style, story, symbol, and equation faces', async () => {
  let request: FontResolutionRequest | undefined;
  const resolver = defineFontResolver((next: FontResolutionRequest) => {
    request = next;
    return {
      ...fontFragment(),
      substitutions: next.families.map((family) => ({
        from: { family, weight: 400, style: 'normal' as const },
        to: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
      })),
    };
  });
  const opened = await openFontBackedDocumentForExport(fontCatalogDocx(), { fonts: resolver });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  // 'Symbol Face' comes from a `w:sym/@w:font`, so it ranks with the other synthesized
  // glyph faces — the SYMBOL fields below it — rather than with the faces text renders in.
  expect(request?.families).toEqual([
    'Body Face',
    'CJK Face',
    'Box Text',
    'Field Face',
    'Autonum Marker',
    'Button Marker',
    'Soft Cache Marker',
    'Soft Cache Face',
    'Checkbox Marker',
    'Symbol Face',
    'Cambria Math',
    'Box Marker Face',
    'Marker Face',
    'Simple Auto Face',
    'Style Face',
    'Symbol Style Face',
    'Header Face',
    'Header Textbox Page',
    'Note Face',
    'Note Ref Marker',
    'Note Auto Marker',
    'DengXian',
  ]);
  expect(request?.families).not.toContain('Note Page Marker');
  expect(request?.families).not.toContain('Note PageRef Marker');
  expect(request?.defaultFamily).toBe('Calibri');
  expect(request?.signal).toBeInstanceOf(AbortSignal);
  expect((await opened.session.layout()).pages).toHaveLength(1);
  opened.session.dispose();
  opened.session.dispose();
});

test('empty origins report missing coverage and retain the deterministic fallback', async () => {
  let coverage: readonly string[] | undefined;
  const opened = await openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: [],
    onFontResolution: (report) => {
      coverage = report.families.map((family) => family.coverage);
    },
  });
  expect(opened.ok).toBe(true);
  expect(coverage?.every((entry) => entry === 'none')).toBe(true);
  if (!opened.ok) return;
  expect((await opened.session.layout()).pages).toHaveLength(1);
  opened.session.dispose();
});

test('strict font policy still refuses an export when no origin admits a source', async () => {
  try {
    await openFontBackedDocumentForExport(fontCatalogDocx(), {
      fonts: [],
      fontPolicy: 'strict',
    });
    throw new Error('expected strict font provisioning to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('layoutFailed');
  }
});

test('export waits for faces an origin delivers after the first paint', async () => {
  let coverage: string | undefined;
  const opened = await openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: defineFontResolver(() => ({
      sources: [],
      deferred: Promise.resolve(fontFragment('Body Face')),
    })),
    onFontResolution: (report) => {
      coverage = report.families.find((family) => family.family === 'Body Face')?.coverage;
    },
  });
  expect(opened.ok).toBe(true);
  // Only the deferred answer supplies Body Face, so it counts only if export awaited it.
  expect(coverage).not.toBe('none');
  if (opened.ok) opened.session.dispose();
});

test('supplied bytes materially drive published line measurement', async () => {
  const bytes = fontCatalogDocx();
  const shaped = await openFontBackedDocumentForExport(bytes, {
    fonts: defineFontResolver((request: FontResolutionRequest) => ({
      ...fontFragment(),
      substitutions: request.families.map((family) => ({
        from: { family, weight: 400, style: 'normal' as const },
        to: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
      })),
    })),
  });
  const fixed = openCoreDocumentForExport(bytes);
  expect(shaped.ok).toBe(true);
  expect(fixed.ok).toBe(true);
  if (!shaped.ok || !fixed.ok) return;
  try {
    const shapedLayout = await shaped.session.layout();
    const fixedLayout = await fixed.session.layout();
    const shapedBody = shapedLayout.pages[0]!.fragments[0]!;
    const fixedBody = fixedLayout.pages[0]!.fragments[0]!;
    expect(shapedBody.kind).toBe('paragraph');
    expect(fixedBody.kind).toBe('paragraph');
    if (shapedBody.kind !== 'paragraph' || fixedBody.kind !== 'paragraph') return;
    expect(shapedBody.lines[0]!.spans[0]!.text).toBe('Body');
    expect(shapedBody.lines[0]!.spans[0]!.box.width).not.toBe(
      fixedBody.lines[0]!.spans[0]!.box.width
    );
  } finally {
    shaped.session.dispose();
    fixed.session.dispose();
  }
});

test('font provisioning maps host abort and deadline to typed errors and permits retry', async () => {
  const controller = new AbortController();
  controller.abort('host-stop');
  const never = defineFontResolver(
    (request: FontResolutionRequest) =>
      new Promise<undefined>((resolve) => {
        request.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
      })
  );
  const aborted = await openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: never,
    signal: controller.signal,
  });
  expect(aborted).toEqual({ ok: false, reason: 'aborted' });
  const inFlightController = new AbortController();
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const inFlight = openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: defineFontResolver(
      (request: FontResolutionRequest) =>
        new Promise<undefined>((resolve) => {
          markStarted?.();
          request.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
        })
    ),
    signal: inFlightController.signal,
  });
  await started;
  // A caller may use the old textual timeout marker as its own reason; it must remain a host abort.
  inFlightController.abort('font-resolution-timeout');
  expect(await inFlight).toEqual({ ok: false, reason: 'aborted' });
  try {
    await openFontBackedDocumentForExport(fontCatalogDocx(), {
      fonts: never,
      fontResolutionTimeoutMs: 5,
    });
    throw new Error('expected resource failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('timedOut');
  }

  let lateFallbackCalls = 0;
  const rejectsOnAbort = defineFontResolver(
    (request: FontResolutionRequest) =>
      new Promise<undefined>((_resolve, reject) => {
        request.signal?.addEventListener(
          'abort',
          () => reject(request.signal?.reason ?? new Error('aborted')),
          { once: true }
        );
      })
  );
  const lateFallback = defineFontResolver(() => {
    lateFallbackCalls += 1;
    return fontFragment();
  });
  try {
    await openFontBackedDocumentForExport(fontCatalogDocx(), {
      fonts: [rejectsOnAbort, lateFallback],
      fontResolutionTimeoutMs: 5,
    });
    throw new Error('expected deadline');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('timedOut');
  }
  expect(lateFallbackCalls).toBe(0);

  const retry = await openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: fontFragment(),
  });
  expect(retry.ok).toBe(true);
  if (retry.ok) retry.session.dispose();
});

test('a pre-aborted custom-font export returns the typed refusal and invokes no origin', async () => {
  const reason = { job: 'cancelled-before-fonts' };
  const controller = new AbortController();
  controller.abort(reason);
  let calls = 0;
  const resolver = defineFontResolver(() => {
    calls += 1;
    return fontFragment();
  });
  const opened = await openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: resolver,
    signal: controller.signal,
  });
  expect(opened).toEqual({ ok: false, reason: 'aborted' });
  expect(calls).toBe(0);
});

test('font-backed byte sessions reject incremental reuse at the Core boundary', async () => {
  await expect(
    openFontBackedDocumentForExport(fontCatalogDocx(), {
      fonts: fontFragment(),
      ...({ reuseAcrossRevisions: true } as Record<string, unknown>),
    })
  ).rejects.toThrow('document-aware byte sessions are immutable');
});

test('caller abort releases the document font lease without requiring explicit disposal', async () => {
  const controller = new AbortController();
  const opened = await openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: fontFragment(),
    signal: controller.signal,
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;

  controller.abort('job-cancelled');
  await expect(opened.session.layout()).rejects.toMatchObject({ code: 'aborted' });

  const parsed = openHeadlessDocument(fontCatalogDocx());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const activeBytes: number[] = [];
  const probe = await acquireDocumentExportShaping(parsed.view, [fontFragment('Probe Face')], {
    onActiveFontBytesChange: (bytes) => activeBytes.push(bytes),
  });
  expect(activeBytes[0]).toBe(0);
  probe?.dispose();
  expect(activeBytes.at(-1)).toBe(0);
  opened.session.dispose();
});

test('structured font evidence reports failures and strict mode enforces complete coverage', async () => {
  const failed = defineFontResolver(() => {
    throw new Error('licensed font service unavailable');
  });
  const complete = defineFontResolver((request: FontResolutionRequest) => ({
    ...completeFontFragment(),
    substitutions: request.families.flatMap((family) =>
      [
        { weight: 400, style: 'normal' as const },
        { weight: 700, style: 'normal' as const },
        { weight: 400, style: 'italic' as const },
        { weight: 700, style: 'italic' as const },
      ].map((face) => ({
        from: { family, ...face },
        to: { family: 'DejaVu Sans', ...face },
      }))
    ),
  }));
  let report:
    | Parameters<
        NonNullable<Parameters<typeof openFontBackedDocumentForExport>[1]['onFontResolution']>
      >[0]
    | undefined;
  const bestEffort = await openFontBackedDocumentForExport(fontCatalogDocx(), {
    fonts: [failed, complete],
    onFontResolution: (next) => {
      report = next;
    },
  });
  expect(bestEffort.ok).toBe(true);
  expect(report?.originFailures).toHaveLength(1);
  expect(report?.originFailures[0]?.originIndex).toBe(0);
  expect(report?.families.every((family) => family.coverage === 'complete')).toBe(true);
  if (!report) throw new Error('expected font-resolution evidence');
  if (bestEffort.ok) {
    expect(bestEffort.session.fontResolution).toBe(report);
    expect(Object.isFrozen(bestEffort.session.fontResolution)).toBe(true);
    bestEffort.session.dispose();
    expect(bestEffort.session.fontResolution).toBe(report);
  }

  try {
    await openFontBackedDocumentForExport(fontCatalogDocx(), {
      fonts: [failed, complete],
      fontPolicy: 'strict',
      onFontResolution: () => {},
    });
    throw new Error('expected strict font refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('layoutFailed');
    expect(String(error)).toContain('font origin failed');
  }
});

test('font-report callback failures are observed without affecting export', async () => {
  const unhandled: unknown[] = [];
  const warnings: unknown[][] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  process.on('unhandledRejection', onUnhandled);
  try {
    const synchronous = await openFontBackedDocumentForExport(
      minimalDocx('<w:p><w:r><w:t>Synchronous diagnostics</w:t></w:r></w:p>'),
      {
        fonts: fontFragment(),
        onFontResolution: () => {
          throw new Error('sync report failed');
        },
      }
    );
    expect(synchronous.ok).toBe(true);
    if (synchronous.ok) {
      expect(synchronous.session.fontResolution.families.length).toBeGreaterThan(0);
      synchronous.session.dispose();
    }

    const opened = await openFontBackedDocumentForExport(
      minimalDocx('<w:p><w:r><w:t>Diagnostics</w:t></w:r></w:p>'),
      {
        fonts: fontFragment(),
        onFontResolution: async () => {
          throw new Error('async report failed');
        },
      }
    );
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.session.fontResolution.families.length).toBeGreaterThan(0);
      opened.session.dispose();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).toHaveLength(0);
    expect(warnings).toHaveLength(2);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    console.warn = warn;
  }
});

test('strict evidence and layout lookup share case-insensitive face identity', async () => {
  const bytes = minimalDocx(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="roboto"/></w:rPr><w:t>Case-sensitive pagination would be wrong</w:t></w:r></w:p>'
  );
  const fixed = openCoreDocumentForExport(bytes);
  expect(fixed.ok).toBe(true);
  if (!fixed.ok) return;
  const fixedLayout = await fixed.session.layout();
  const fixedParagraph = fixedLayout.pages[0]!.fragments[0]!;
  expect(fixedParagraph.kind).toBe('paragraph');
  if (fixedParagraph.kind !== 'paragraph') return;
  const fixedWidth = fixedParagraph.lines[0]!.spans[0]!.box.width;

  const direct = completeFontFragment('Roboto');
  const substituted = {
    ...completeFontFragment('DejaVu Sans'),
    substitutions: [
      { weight: 400, style: 'normal' as const },
      { weight: 700, style: 'normal' as const },
      { weight: 400, style: 'italic' as const },
      { weight: 700, style: 'italic' as const },
    ].map((face) => ({
      from: { family: 'ROBOTO', ...face },
      to: { family: 'DejaVu Sans', ...face },
    })),
  };
  for (const fonts of [direct, substituted]) {
    let report:
      | Parameters<
          NonNullable<Parameters<typeof openFontBackedDocumentForExport>[1]['onFontResolution']>
        >[0]
      | undefined;
    const opened = await openFontBackedDocumentForExport(bytes, {
      fonts,
      fontPolicy: 'strict',
      onFontResolution: (next) => {
        report = next;
      },
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) continue;
    const family = report?.families.find((entry) => entry.family === 'roboto');
    expect(family?.coverage).toBe('complete');
    const layout = await opened.session.layout();
    const paragraph = layout.pages[0]!.fragments[0]!;
    expect(paragraph.kind).toBe('paragraph');
    if (paragraph.kind === 'paragraph') {
      expect(paragraph.lines[0]!.spans[0]!.box.width).not.toBe(fixedWidth);
    }
    opened.session.dispose();
  }
  fixed.session.dispose();
});

test('strict evidence is derived from admitted font bytes, not declared sources', async () => {
  const bytes = minimalDocx(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Broken Face"/></w:rPr><w:t>x</w:t></w:r></w:p>'
  );
  const valid = completeFontFragment('Broken Face');
  const malformedBytes = new Uint8Array([0, 1, 2, 3]);
  const malformed = {
    ...valid,
    sources: valid.sources.map((source) => ({
      ...source,
      bytes: malformedBytes,
      hash: sha256FontBytes(malformedBytes),
    })),
  };
  const hashMismatch = {
    ...valid,
    sources: valid.sources.map((source) => ({ ...source, hash: '00'.repeat(32) })),
  };
  for (const fonts of [hashMismatch, malformed]) {
    let report:
      | Parameters<
          NonNullable<Parameters<typeof openFontBackedDocumentForExport>[1]['onFontResolution']>
        >[0]
      | undefined;
    const bestEffort = await openFontBackedDocumentForExport(bytes, {
      fonts,
      onFontResolution: (next) => {
        report = next;
      },
    });
    expect(bestEffort.ok).toBe(true);
    expect(report?.families.find((family) => family.family === 'Broken Face')?.coverage).toBe(
      'none'
    );
    if (bestEffort.ok) bestEffort.session.dispose();

    try {
      await openFontBackedDocumentForExport(bytes, {
        fonts,
        fontPolicy: 'strict',
        onFontResolution: () => {},
      });
      throw new Error('expected strict admission refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ExportResourceError);
      expect((error as ExportResourceError).code).toBe('layoutFailed');
    }
  }
});

test('total font-origin failure publishes evidence before best-effort fallback', async () => {
  const bytes = minimalDocx(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Missing Face"/></w:rPr><w:t>x</w:t></w:r></w:p>'
  );
  for (const [fonts, expectedFailures] of [
    [
      defineFontResolver(() => {
        throw new Error('offline');
      }),
      1,
    ],
    [undefined, 0],
    [
      {
        substitutions: [
          {
            from: { family: 'Missing Face', weight: 400, style: 'normal' as const },
            to: { family: 'Unavailable Substitute', weight: 400, style: 'normal' as const },
          },
        ],
      },
      0,
    ],
  ] as const) {
    let report:
      | Parameters<
          NonNullable<Parameters<typeof openFontBackedDocumentForExport>[1]['onFontResolution']>
        >[0]
      | undefined;
    const opened = await openFontBackedDocumentForExport(bytes, {
      fonts,
      onFontResolution: (next) => {
        report = next;
      },
    });
    expect(opened.ok).toBe(true);
    expect(report?.originFailures).toHaveLength(expectedFailures);
    expect(report?.families.find((family) => family.family === 'Missing Face')?.coverage).toBe(
      'none'
    );
    if (opened.ok) opened.session.dispose();
  }
});

test('cached and inert field markers cannot crowd rendered families out of the resolver bound', async () => {
  let request: FontResolutionRequest | undefined;
  const resolver = defineFontResolver((next: FontResolutionRequest) => {
    request = next;
    return {
      ...fontFragment(),
      substitutions: next.families.map((family) => ({
        from: { family, weight: 400, style: 'normal' as const },
        to: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
      })),
    };
  });
  const opened = await openFontBackedDocumentForExport(fieldFloodDocx(), { fonts: resolver });
  expect(opened.ok).toBe(true);
  expect(request?.families).toEqual(['Body Face', 'Cached Face']);
  if (opened.ok) opened.session.dispose();
});

test('body textbox PAGE fields stay deferred and cannot crowd active fonts out', async () => {
  const fields = Array.from(
    { length: 65 },
    (_, index) =>
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>` +
      `<w:r><w:rPr><w:rFonts w:ascii="Textbox Page ${index}"/></w:rPr><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>`
  ).join('');
  const bytes = minimalDocx(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Body Face"/></w:rPr><w:t>body</w:t>' +
      `<w:drawing><w:txbxContent>${fields}` +
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Textbox Symbol Marker"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText> SYMBOL 42 </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      '</w:txbxContent></w:drawing></w:r></w:p>'
  );
  let request: FontResolutionRequest | undefined;
  const resolver = defineFontResolver((next: FontResolutionRequest) => {
    request = next;
    return fontFragment();
  });
  const opened = await openFontBackedDocumentForExport(bytes, { fonts: resolver });
  expect(opened.ok).toBe(true);
  expect(request?.families).toContain('Body Face');
  expect(request?.families).toContain('Textbox Symbol Marker');
  expect(request?.families.some((family) => family.startsWith('Textbox Page '))).toBe(false);
  if (opened.ok) opened.session.dispose();
});

test('simple and textbox complex SYMBOL fields expose projected marker and explicit faces', async () => {
  const bytes = minimalDocx(
    '<w:p><w:fldSimple w:instr=\' SYMBOL 183 \\f "Simple Symbol" \'/></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/>' +
      '<w:drawing><w:txbxContent><w:p>' +
      '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> SYMBOL 183 \\f "Textbox Symbol" </w:instrText></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Textbox Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p></w:txbxContent></w:drawing><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="No Separate Symbol Marker"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText> SYMBOL 42 </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
  let request: FontResolutionRequest | undefined;
  const resolver = defineFontResolver((next: FontResolutionRequest) => {
    request = next;
    return fontFragment();
  });
  const opened = await openFontBackedDocumentForExport(bytes, { fonts: resolver });
  expect(opened.ok).toBe(true);
  expect(request?.families).toContain('Simple Symbol');
  expect(request?.families).toContain('Textbox Symbol');
  expect(request?.families).toContain('Textbox Marker');
  expect(request?.families).toContain('No Separate Symbol Marker');
  if (opened.ok) opened.session.dispose();
});

test('revision-conditional field caches retain synthesized marker coverage for every view', async () => {
  const bytes = minimalDocx(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Deleted Cache Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:del w:id="1" w:author="Reviewer"><w:r><w:t>9</w:t></w:r></w:del>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Inserted Cache Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:ins w:id="2" w:author="Reviewer"><w:r><w:t>8</w:t></w:r></w:ins>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Move From Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:moveFrom w:id="3" w:author="Reviewer"><w:r><w:t>7</w:t></w:r></w:moveFrom>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Move To Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:moveTo w:id="4" w:author="Reviewer"><w:r><w:t>6</w:t></w:r></w:moveTo>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Paired Replacement Marker"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:del w:id="5" w:author="Reviewer"><w:r><w:t>5</w:t></w:r></w:del>' +
      '<w:ins w:id="6" w:author="Reviewer"><w:r><w:t>4</w:t></w:r></w:ins>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
  let request: FontResolutionRequest | undefined;
  const resolver = defineFontResolver((next: FontResolutionRequest) => {
    request = next;
    return fontFragment();
  });
  const opened = await openFontBackedDocumentForExport(bytes, { fonts: resolver });
  expect(opened.ok).toBe(true);
  expect(request?.families).toContain('Deleted Cache Marker');
  expect(request?.families).toContain('Inserted Cache Marker');
  expect(request?.families).toContain('Move From Marker');
  expect(request?.families).toContain('Move To Marker');
  expect(request?.families).not.toContain('Paired Replacement Marker');
  if (opened.ok) opened.session.dispose();
});

test('disposed document-specific shaping never consumes the process static cache or active budget', async () => {
  const parsed = openHeadlessDocument(fontCatalogDocx());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const retained = [];
  for (let index = 0; index < 180; index += 1) {
    const family = `Lease Face ${index}`;
    const shaping = await acquireDocumentExportShaping(parsed.view, [
      fontFragment(family, String(index)),
    ]);
    expect(shaping).toBeDefined();
    shaping?.dispose();
    retained.push(shaping);
  }
  expect(retained).toHaveLength(180);
}, 20_000);

test('a timed-out non-cooperative origin unwinds every earlier font-byte lease', async () => {
  const parsed = openHeadlessDocument(minimalDocx('<w:p><w:r><w:t>Lease</w:t></w:r></w:p>'));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const activeBytes: number[] = [];
  const stuck = defineFontResolver(() => new Promise<undefined>(() => {}));

  await expect(
    acquireDocumentExportShaping(parsed.view, [fontFragment(), stuck], {
      timeoutMs: 10,
      onActiveFontBytesChange: (bytes) => activeBytes.push(bytes),
    })
  ).rejects.toMatchObject({ code: 'timedOut' });
  expect(activeBytes.some((bytes) => bytes > activeBytes[0]!)).toBe(true);
  expect(activeBytes.at(-1)).toBe(activeBytes[0]);

  const retryBytes: number[] = [];
  const retry = await acquireDocumentExportShaping(parsed.view, [fontFragment()], {
    onActiveFontBytesChange: (bytes) => retryBytes.push(bytes),
  });
  expect(retry).toBeDefined();
  retry?.dispose();
  expect(retryBytes.at(-1)).toBe(retryBytes[0]);
});

test('a family catalog beyond the safe resolver bound truncates instead of refusing', async () => {
  let request: FontResolutionRequest | undefined;
  const resolver = defineFontResolver((next: FontResolutionRequest) => {
    request = next;
    return fontFragment();
  });
  const opened = await openFontBackedDocumentForExport(priorityDocx(), { fonts: resolver });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  opened.session.dispose();
  // File-supplied names cannot refuse the document; the resolver sees at most the cap, and the
  // body tier survives the cut ahead of the hostile header flood.
  expect(request).toBeDefined();
  expect(request!.families.length).toBeLessThanOrEqual(64);
  expect(request!.families).toContain('Body Priority Face');
});

test('explicit glyph fallback families reach demand-driven resolvers within the catalog bound', async () => {
  let request: FontResolutionRequest | undefined;
  const resolver = defineFontResolver((next: FontResolutionRequest) => {
    request = next;
    return fontFragment();
  });
  const fallback = { family: 'Explicit Fallback', weight: 400, style: 'normal' as const };
  const opened = await openFontBackedDocumentForExport(priorityDocx(), {
    fonts: resolver,
    glyphFallbacks: [fallback, fallback],
  });
  expect(opened.ok).toBe(true);
  if (opened.ok) opened.session.dispose();
  expect(request!.families.filter((family) => family === fallback.family)).toHaveLength(1);
  expect(request!.families).toContain('Body Priority Face');
  expect(request!.families.length).toBeLessThanOrEqual(64);
});

test('excess glyph fallback requests fail before font origins allocate bytes', async () => {
  const parsed = openHeadlessDocument(minimalDocx('<w:p/>'));
  if (!parsed.ok) throw new Error(parsed.reason);
  let called = false;
  const resolver = defineFontResolver(() => {
    called = true;
    return fontFragment();
  });
  await expect(
    acquireDocumentExportShaping(parsed.view, [resolver], {
      glyphFallbacks: Array.from({ length: 17 }, (_, i) => ({
        family: `Fallback ${i}`,
        weight: 400,
        style: 'normal' as const,
      })),
    })
  ).rejects.toThrow('At most 16 glyph fallback faces');
  expect(called).toBe(false);
});
