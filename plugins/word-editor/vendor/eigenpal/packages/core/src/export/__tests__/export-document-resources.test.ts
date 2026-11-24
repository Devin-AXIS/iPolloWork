import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { openDocumentForExport } from '../export-session.ts';
import { collectExportContentWarnings } from '../export-content-warnings.ts';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import { MAX_XML_DEPTH } from '../../store/package/ooxml-drawing-rules.ts';
import { exportDestinationNamed } from '../export-document-resources.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC = 'http://purl.org/dc/elements/1.1/';
const EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

function docxBytes(
  body: string,
  withMetadata = true,
  extra: {
    readonly relationships?: string;
    readonly contentTypes?: string;
    readonly entries?: Readonly<Record<string, Uint8Array>>;
  } = {}
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (withMetadata
          ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
          : '') +
        (extra.contentTypes ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        (withMetadata
          ? `<Relationship Id="rCore" Type="${REL}/metadata/core-properties" Target="docProps/core.xml"/>` +
            `<Relationship Id="rApp" Type="${R}/extended-properties" Target="docProps/app.xml"/>`
          : '') +
        '</Relationships>'
    ),
    ...(extra.relationships
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}">${extra.relationships}</Relationships>`
          ),
        }
      : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    ...(withMetadata
      ? {
          'docProps/core.xml': strToU8(
            `<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${DC}">` +
              '<dc:title>Export Title</dc:title>' +
              '<dc:creator>Export Author</dc:creator>' +
              '</cp:coreProperties>'
          ),
          'docProps/app.xml': strToU8(
            `<Properties xmlns="${EP}"><Company>Export Co</Company></Properties>`
          ),
        }
      : {}),
    ...(extra.entries ?? {}),
  });
}

test('immutable byte export provides frozen metadata and destinations from one layout call', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:bookmarkStart w:id="1" w:name="Jump"/><w:r><w:t>Target text</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
        '<w:p><w:hyperlink w:anchor="Jump"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>'
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();

  expect(layout.documentMetadata).toEqual({
    title: 'Export Title',
    creator: 'Export Author',
    company: 'Export Co',
  });
  expect(Object.isFrozen(layout.documentMetadata)).toBe(true);
  expect(layout.destinations).toBeDefined();
  expect(Object.isFrozen(layout.destinations)).toBe(true);
  expect(layout.destinations!.length).toBe(1);

  const destination = exportDestinationNamed(layout, 'Jump');
  expect(destination?.anchor.name).toBe('Jump');
  expect(destination?.pageIndex).toBe(0);
  expect(destination!.pageContent.height).toBeGreaterThan(0);
  const page = layout.pages[0]!;
  expect(destination!.pageStack.y).toBeCloseTo(page.contentBox.y + destination!.pageContent.y, 4);
  expect(exportDestinationNamed(layout, 'Missing')).toBeUndefined();

  opened.session.dispose();
});

test('a destination before a leading page break resolves to the page of the text', async () => {
  // Older files keep a heading bookmark in front of the break. The link still lands on page 2.
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:hyperlink w:anchor="Second"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>' +
        '<w:p><w:bookmarkStart w:id="1" w:name="Second"/><w:r><w:br w:type="page"/></w:r>' +
        '<w:r><w:t>Second heading</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();
  expect(layout.pages.length).toBe(2);
  const destination = exportDestinationNamed(layout, 'Second');
  expect(destination?.pageIndex).toBe(1);
  expect(destination?.anchor.offset).toBe(0);
  opened.session.dispose();
});

test('byte export without docProps publishes empty frozen metadata and destinations', async () => {
  const opened = openDocumentForExport(
    docxBytes('<w:p><w:r><w:t>No metadata</w:t></w:r></w:p>', false)
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();

  expect(layout.documentMetadata).toEqual({});
  expect(Object.isFrozen(layout.documentMetadata)).toBe(true);
  expect(layout.destinations).toEqual([]);
  expect(Object.isFrozen(layout.destinations)).toBe(true);
  opened.session.dispose();
});

test('metadata and destinations survive session disposal on the published layout', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:bookmarkStart w:id="1" w:name="Keep"/><w:r><w:t>After dispose</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();
  opened.session.dispose();

  expect(Object.isFrozen(layout)).toBe(true);
  expect(layout.documentMetadata?.title).toBe('Export Title');
  expect(exportDestinationNamed(layout, 'Keep')?.anchor.name).toBe('Keep');
  await expect(opened.session.layout()).rejects.toMatchObject({ code: 'disposed' });
});

test('layoutFor republishes metadata and destinations per revision projection', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:bookmarkStart w:id="1" w:name="Mode"/><w:r><w:t>Stable</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const allMarkup = await opened.session.layout();
  const proposed = await opened.session.layoutFor('proposed');
  expect(allMarkup.documentMetadata).toEqual(proposed.documentMetadata);
  expect(exportDestinationNamed(allMarkup, 'Mode')?.pageIndex).toBe(
    exportDestinationNamed(proposed, 'Mode')?.pageIndex
  );
  opened.session.dispose();
});

test('header and note destinations publish caret geometry in page-content space', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr>',
      true,
      {
        relationships:
          `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rNotes" Type="${R}/footnotes" Target="footnotes.xml"/>`,
        contentTypes:
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
        entries: {
          'word/header1.xml': strToU8(
            `<w:hdr xmlns:w="${W}">` +
              '<w:p><w:bookmarkStart w:id="1" w:name="HeaderJump"/>' +
              '<w:r><w:t>Header target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p></w:hdr>'
          ),
          'word/footnotes.xml': strToU8(
            `<w:footnotes xmlns:w="${W}">` +
              '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
              '<w:footnote w:type="continuationSeparator" w:id="0">' +
              '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
              '<w:footnote w:id="1"><w:p><w:bookmarkStart w:id="2" w:name="NoteJump"/>' +
              '<w:r><w:t>Note target</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p></w:footnote></w:footnotes>'
          ),
        },
      }
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();
  const page = layout.pages[0]!;
  const header = page.header;
  const note = page.footnotes?.notes[0];
  expect(header).toBeDefined();
  expect(note).toBeDefined();

  const headerDestination = exportDestinationNamed(layout, 'HeaderJump');
  expect(headerDestination).toBeDefined();
  const headerCaret = caretAt(layout, headerDestination!.anchor);
  expect(headerCaret).not.toBeNull();
  const headerOriginY = header!.box.y - page.contentBox.y;
  expect(Math.abs(headerOriginY)).toBeGreaterThan(1);
  expect(headerDestination!.pageContent.y).toBeCloseTo(headerCaret!.y + headerOriginY, 4);
  expect(headerDestination!.pageStack.y).toBeCloseTo(
    page.contentBox.y + headerDestination!.pageContent.y,
    4
  );

  const noteDestination = exportDestinationNamed(layout, 'NoteJump');
  expect(noteDestination).toBeDefined();
  const noteCaret = caretAt(layout, noteDestination!.anchor);
  expect(noteCaret).not.toBeNull();
  const noteOriginY = note!.box.y - page.contentBox.y;
  expect(Math.abs(noteOriginY)).toBeGreaterThan(1);
  expect(noteDestination!.pageContent.y).toBeCloseTo(noteCaret!.y + noteOriginY, 4);
  expect(noteDestination!.pageStack.y).toBeCloseTo(
    page.contentBox.y + noteDestination!.pageContent.y,
    4
  );

  opened.session.dispose();
});

test('source diagnostics skip inactive legacy fallbacks and report scan limits', () => {
  const legacy =
    '<v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>' +
    '<w:p><w:r><w:t>Legacy text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>';
  const body =
    '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<mc:Choice Requires="wps"><w:drawing/></mc:Choice><mc:Fallback><w:pict>' +
    legacy +
    '</w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>';
  const opened = openHeadlessDocument(docxBytes(body, false));
  if (!opened.ok) throw new Error(opened.reason);
  expect(collectExportContentWarnings(opened.view)).toEqual([]);
  const part = opened.view.part();
  let nested = part.root;
  for (let i = 0; i <= MAX_XML_DEPTH; i++)
    nested = { ...part.root, kind: 'generic', localName: 'wrapper', children: [nested] };
  const warnings = collectExportContentWarnings({
    ...opened.view,
    part: () => ({ ...part, root: nested }),
  });
  expect(warnings).toEqual([{ code: 'scan-limit', partName: '/word/document.xml' }]);
  expect(Object.isFrozen(warnings)).toBe(true);
});

test('source diagnostics accept a text box whose path flags are inert', () => {
  const box = (path: string) =>
    '<w:p><w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">' +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
    '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    '<v:shape type="#_x0000_t202" style="width:540pt;height:80pt;margin-top:60pt;margin-left:36pt;' +
    'mso-position-horizontal-relative:page;mso-position-vertical-relative:page;position:absolute;' +
    `z-index:251661312" filled="f" stroked="f">${path}<v:textbox><w:txbxContent>` +
    '<w:p><w:r><w:t>Banner title</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>' +
    '</w:pict></w:r></w:p>';
  for (const [path, warnings] of [
    ['<v:path strokeok="f" textboxrect="0,0,21600,21600"/>', []],
    // The text box template keeps its whole box whatever text area the shape writes.
    ['<v:path textboxrect="0,0,10800,21600"/>', []],
    [
      '<v:path textboxrect="0,0,21600,21600"><v:f eqn="val 1"/></v:path>',
      [{ code: 'legacy-textbox', partName: '/word/document.xml' }],
    ],
  ] as const) {
    const opened = openHeadlessDocument(docxBytes(box(path), false));
    if (!opened.ok) throw new Error(opened.reason);
    expect(collectExportContentWarnings(opened.view)).toEqual(warnings);
  }
});

test('source diagnostics accept a framed object preview as a drawing', () => {
  const body =
    '<w:p><w:pPr><w:framePr w:y="-854" w:vAnchor="text"/></w:pPr><w:r><w:t>Before</w:t>' +
    '<w:object xmlns:v="urn:schemas-microsoft-com:vml"><v:shape type="#_x0000_t75" style="width:52.5pt;height:56.25pt"><v:imagedata r:id="preview"/></v:shape></w:object>' +
    '<w:t>After</w:t></w:r></w:p>';
  const opened = openHeadlessDocument(docxBytes(body, false));
  if (!opened.ok) throw new Error(opened.reason);
  expect(collectExportContentWarnings(opened.view)).toEqual([]);
});

test('source diagnostics identify hidden paragraph joins outside the supported subset', () => {
  const p = (mark: string, align = 'left') =>
    `<w:p><w:pPr><w:jc w:val="${align}"/><w:rPr>${mark}</w:rPr></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>`;
  for (const [body, unsupported] of [
    [p('<w:vanish/><w:specVanish/>') + p(''), false],
    [p('<w:vanish/><w:specVanish/>') + p('', 'right'), true],
    [p('<w:vanish/>') + p(''), false],
    [p('<w:vanish/>') + p('', 'right'), true],
    [p('<w:specVanish/>') + p(''), false],
  ] as const) {
    const opened = openHeadlessDocument(docxBytes(body, false));
    if (!opened.ok) throw new Error(opened.reason);
    expect(collectExportContentWarnings(opened.view)).toEqual(
      unsupported ? [{ code: 'unsupported-style-separator', partName: '/word/document.xml' }] : []
    );
  }
});

test('source diagnostics defer projected MC legacy fallbacks to page-level warnings', () => {
  const pict = (style: string) =>
    '<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" ' +
    `id="Fallback" style="${style}" path="unsupported"/></w:pict>`;
  for (const [fallback, represented] of [
    [pict('width:100pt;height:50pt'), true],
    [pict('width:100pt;height:50pt;rotation:15'), true],
    // Without usable drawing geometry, the source warning must remain.
    [pict(''), false],
    // Unsupported branch nesting does not create a layout record.
    [`<w:r>${pict('width:100pt;height:50pt')}</w:r>`, false],
  ] as const) {
    const body =
      '<w:p><w:r>' +
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
      'xmlns:future="urn:unsupported-shape"><mc:Choice Requires="future"><w:drawing/></mc:Choice>' +
      `<mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></w:r></w:p>`;
    const opened = openHeadlessDocument(docxBytes(body, false));
    if (!opened.ok) throw new Error(opened.reason);
    expect(collectExportContentWarnings(opened.view)).toEqual(
      represented ? [] : [{ code: 'legacy-drawing', partName: '/word/document.xml' }]
    );
  }
});
