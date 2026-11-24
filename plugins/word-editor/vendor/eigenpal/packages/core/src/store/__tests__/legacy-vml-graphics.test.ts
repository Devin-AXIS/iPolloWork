import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  projectDrawingsInPackage,
  projectDrawingsInPart,
  type DrawingProjection,
} from '../package/drawing-projection.ts';
import {
  createImageResourceCache,
  liveDrawingReferenceCount,
  type ImageDecodePort,
  type ImageResourceState,
} from '../package/image-resources.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import {
  mintValidatedImageBytes,
  retainValidatedImageBytes,
  releaseValidatedImageBytesToken,
} from '../package/validated-image-bytes.ts';
import { paragraphLength, segmentsOf } from '../store/tree-op-segments.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { expectRefused } from './legacy-vml-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));

function documentXml(content: string): string {
  return `<w:document xmlns:w="${W}" xmlns:v="${V}" xmlns:o="${O}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>A</w:t>${content}<w:t>Z</w:t></w:r></w:p></w:body></w:document>`;
}

function parse(content: string, renamePrefixes = false): OoxmlPart {
  let xml = documentXml(content);
  if (renamePrefixes) {
    for (const [from, to] of [
      ['w', 'word'],
      ['v', 'legacy'],
      ['o', 'office'],
      ['r', 'rel'],
    ]) {
      xml = xml.replaceAll(`xmlns:${from}=`, `xmlns:${to}=`).replaceAll(`${from}:`, `${to}:`);
    }
  }
  const loaded = readOoxmlPart(xml, metadata);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

function packageOf(content: string, external = false): OoxmlPackage {
  const loaded = readOoxmlPackage(
    zipSync(
      {
        '[Content_Types].xml': strToU8(
          `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${metadata.contentType}"/></Types>`
        ),
        '_rels/.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
        ),
        'word/document.xml': strToU8(documentXml(content)),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rPhoto" Type="${R}/image" Target="${external ? 'https://example.invalid/private.png' : 'media/photo.png'}"${external ? ' TargetMode="External"' : ''}/></Relationships>`
        ),
        'word/media/photo.png': PNG,
      },
      { level: 0 }
    )
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function photo(style = 'width:72pt;height:36pt'): string {
  return `<v:shape id="photo" type="#_x0000_t75" style="${style}"><v:imagedata r:id="rPhoto" o:title="photo"/></v:shape>`;
}

function group(extra = '', width = '200pt'): string {
  return `<w:pict><v:group id="annotation" style="width:${width};height:100pt" coordorigin="100,200" coordsize="1000,500">${photo('left:200;top:250;width:500;height:250')}<v:shape type="#_x0000_t32" style="left:200;top:250;width:500;height:250" strokecolor="#ff0000" strokeweight="2pt"><v:stroke endarrow="block" endarrowwidth="wide" endarrowlength="long"/></v:shape>${extra}</v:group></w:pict>`;
}

/**
 * WordArt inside a group, which paints through the graphic preview. A WordArt shape on its
 * own projects as text art instead (`legacy-vml-text-art.test.ts`).
 */
function wordArt(text = 'A &amp; B &lt;tag&gt; &quot;quoted&quot;', width = '120pt'): string {
  return `<w:pict><v:group id="art" style="width:${width};height:30pt" coordsize="1000,1000"><v:shape id="title" type="#_x0000_t136" style="left:0;top:0;width:1000;height:1000" fillcolor="#112233" stroked="f"><v:textpath on="t" fitshape="t" style="font-family:Times New Roman;font-size:24pt;font-weight:bold" string="${text}"/></v:shape></v:group></w:pict>`;
}

function onlyProjection(part: OoxmlPart): DrawingProjection {
  const projections = projectDrawingsInPart(part);
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body');
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children.find((n) => n.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return paragraph;
}

function decodePort(): ImageDecodePort & { calls: number } {
  return {
    calls: 0,
    async decode(bytes, mime) {
      this.calls++;
      expect(mime).toBe('image/png');
      expect(bytes).toEqual(PNG);
      return { pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 };
    },
  };
}

function svgOf(state: ImageResourceState): string {
  expect(state.kind).toBe('ready');
  if (state.kind !== 'ready') throw new Error(`Expected ready, got ${state.kind}`);
  expect(state.mime).toBe('image/svg+xml');
  const bytes = mintValidatedImageBytes(state.validatedHandle, state.contentId);
  expect(bytes).not.toBeNull();
  return new TextDecoder().decode(bytes!);
}

describe('bounded legacy VML projections', () => {
  test('projects colour-keyed equation previews without interpreting their source metadata', () => {
    for (const renamed of [false, true]) {
      const content = photo()
        .replace(
          'id="photo"',
          `id="photo" ${renamed ? 'o:' : ''}equationxml="${'x'.repeat(28_000)}"`
        )
        .replace('o:title="photo"', 'o:title="photo" chromakey="#FFFFFF" cropleft="8192f"');
      const part = parse(`<w:pict>${content}</w:pict>`, renamed);
      const before = serializeOoxmlPart(part);
      const fragment = onlyProjection(part).legacyGraphic!.fragments[0]!;
      expect(typeof fragment).toBe('object');
      if (typeof fragment === 'string') throw new Error('Expected image slot');
      expect(fragment.before).toContain('color-interpolation-filters="sRGB"');
      expect(fragment.before).toContain('filter="url(#vml-key-ffffff)"');
      expect(fragment.before).not.toContain('equationxml');
      expect(fragment.before).not.toContain('x'.repeat(100));
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });

  test('refuses invalid colour keys and retains all input budgets', () => {
    for (const key of ['url(https://example.invalid)', '#ffff', '', 'transparent']) {
      expectRefused(
        projectDrawingsInPart(
          parse(`<w:pict>${photo().replace('o:title="photo"', `chromakey="${key}"`)}</w:pict>`)
        )
      );
    }
    for (const metadata of [
      `o:equationxml="${'x'.repeat(65_537)}"`,
      `o:title="${'x'.repeat(8193)}"`,
      `r:equationxml="${'x'.repeat(28_000)}"`,
    ]) {
      expectRefused(
        projectDrawingsInPart(parse(`<w:pict>${photo().replace('id="photo"', metadata)}</w:pict>`))
      );
    }
  });

  test('accepts disabled equation picture decorations but not visible or custom ones', () => {
    const decorations =
      '<v:path/><v:fill on="f" focussize="0,0"/><v:stroke on="f"/><word:anchorlock xmlns:word="urn:schemas-microsoft-com:office:word"/>';
    const content = `<w:pict>${photo()
      .replace('id="photo"', 'id="photo" filled="f" stroked="f"')
      .replace('<v:imagedata', decorations + '<v:imagedata')
      .replace('o:title="photo"', 'chromakey="#ffffff"')}</w:pict>`;
    expect(projectDrawingsInPart(parse(content))).toHaveLength(1);
    for (const [from, to] of [
      ['<v:path/>', '<v:path v="m0,0l1,1e"/>'],
      ['<v:fill on="f"', '<v:fill on="t"'],
      ['<v:stroke on="f"', '<v:stroke on="t"'],
    ]) {
      expectRefused(projectDrawingsInPart(parse(content.replace(from!, to!))));
    }
  });

  test('recognizes a standalone picture by namespace, not authored prefix', () => {
    for (const renamed of [false, true]) {
      const part = parse(`<w:pict>${photo()}</w:pict>`, renamed);
      const before = serializeOoxmlPart(part);
      const projection = onlyProjection(part);
      expect(projection.kind).toBe('inline');
      expect(projection.extentEmu).toEqual({ cx: 914400, cy: 457200 });
      expect(projection.ownerPartName).toBe('/word/document.xml');
      expect(projection.legacyGraphic).toBeUndefined();
      expect(projection.picture?.embeddedRelationshipId).toBe('rPhoto');
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });

  test('accepts inert Word styles but refuses unsupported layout or conflicting duplicates', () => {
    const style =
      'position:absolute;width:72pt;height:36pt;mso-width-percent:0;mso-width-percent:0;text-align:left;mso-position-horizontal:absolute;mso-position-vertical:absolute';
    const content = `<w:pict>${photo(style).replace('</v:shape>', '<w10:wrap xmlns:w10="urn:schemas-microsoft-com:office:word" anchorx="page" anchory="margin"/></v:shape>')}</w:pict>`;
    const projection = onlyProjection(parse(content));
    expect(projection.picture).not.toBeNull();
    expect(projection.position?.horizontal.relativeFrom).toBe('page');
    expect(projection.position?.vertical.relativeFrom).toBe('margin');
    for (const altered of [
      content.replace(
        'mso-width-percent:0;mso-width-percent:0',
        'mso-width-percent:0;mso-width-percent:50'
      ),
      content.replace('mso-position-horizontal:absolute', 'mso-position-horizontal:middle'),
      content.replace('text-align:left', 'rotation:30'),
      content.replace('anchorx="page"', 'anchorx="unknown"'),
    ])
      expectRefused(projectDrawingsInPart(parse(altered)));
    const centered = onlyProjection(
      parse(content.replace('mso-position-horizontal:absolute', 'mso-position-horizontal:center'))
    );
    expect(centered.position?.horizontal).toEqual({
      relativeFrom: 'page',
      align: 'center',
      offsetEmu: null,
    });
  });

  test('does not project a dead VML fallback beside the selected DrawingML picture', () => {
    const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const pic = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
    const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const choice = `<w:drawing xmlns:wp="${wp}" xmlns:a="${a}" xmlns:pic="${pic}"><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="modern"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="modern"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rModern"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    const part = parse(
      `<mc:AlternateContent xmlns:mc="${mc}" xmlns:supported="urn:test-supported"><mc:Choice Requires="supported">${choice}</mc:Choice><mc:Fallback>${group()}</mc:Fallback></mc:AlternateContent>`
    );
    const projections = projectDrawingsInPart(part, {
      supportedMcRequires: new Set(['urn:test-supported']),
    });
    expect(projections).toHaveLength(1);
    expect(projections[0]!.picture?.embeddedRelationshipId).toBe('rModern');
    expect(projections[0]!.legacyGraphic).toBeUndefined();
  });

  test('maps group coordinates and retains photo-before-arrow paint order', () => {
    const projection = onlyProjection(parse(group()));
    expect(projection.legacyGraphic).toMatchObject({ width: 200, height: 100 });
    const fragments = projection.legacyGraphic!.fragments;
    expect(fragments).toHaveLength(2);
    expect(fragments[0]).toMatchObject({ relationshipId: 'rPhoto' });
    const photoFragment = fragments[0]!;
    if (typeof photoFragment === 'string') throw new Error('Expected photo slot');
    expect(photoFragment.before).toContain('x="20" y="10" width="100" height="50"');
    expect(fragments[1]).toContain('<polyline points="20,10 120,60"');
    expect(fragments[1]).toContain('<path d="M');
    expect(fragments[1]).toContain('fill="#ff0000" stroke="#ff0000"');
  });

  test('maps nested group origin and size without flattening the source tree', () => {
    const nested = `<v:group style="left:100;top:200;width:500;height:250" coordorigin="10,20" coordsize="100,50">${photo('left:20;top:25;width:50;height:25')}</v:group>`;
    const part = parse(group(nested));
    const before = serializeOoxmlPart(part);
    const fragments = onlyProjection(part).legacyGraphic!.fragments;
    expect(fragments).toHaveLength(3);
    const last = fragments[2]!;
    if (typeof last === 'string') throw new Error('Expected nested photo slot');
    expect(last.before).toContain('x="10" y="5" width="50" height="25"');
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('escapes straight WordArt text and keeps canonical OOXML unchanged', () => {
    const part = parse(wordArt());
    const before = serializeOoxmlPart(part);
    const projection = onlyProjection(part);
    const svg = projection.legacyGraphic!.fragments.join('');
    expect(svg).toContain('A &amp; B &lt;tag&gt; &quot;quoted&quot;');
    expect(svg).not.toContain('<tag>');
    expect(svg).toContain('font-family="Times New Roman"');
    expect(svg).toContain('fill="#112233"');
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('refuses an entire mixed group when any member is unsupported', () => {
    for (const extra of [
      '<v:arc style="left:0;top:0;width:1;height:1"/>',
      '<v:shape type="#_x0000_t137" style="left:0;top:0;width:1;height:1"/>',
      '<v:shape style="left:0;top:0;width:1;height:1"><v:textbox/></v:shape>',
    ]) {
      const part = parse(group(extra));
      const before = serializeOoxmlPart(part);
      expectRefused(projectDrawingsInPart(part));
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });

  test('refuses rotation, unsupported crop, remote source markup and oversized drawings', () => {
    const samples = [
      `<w:pict>${photo('width:72pt;height:36pt;rotation:90')}</w:pict>`,
      `<w:pict>${photo('width:10001pt;height:36pt')}</w:pict>`,
      `<w:pict>${photo().replace('r:id="rPhoto"', 'src="https://example.invalid/image.png"')}</w:pict>`,
      `<w:pict>${photo().replace('r:id="rPhoto"', 'r:id="rPhoto" cropleft="0.6" cropright="0.6"')}</w:pict>`,
      wordArt().replace('#_x0000_t136', '#_x0000_t137'),
      wordArt().replace('width:120pt', 'rotation:10;width:120pt'),
      wordArt('x'.repeat(1025)),
    ];
    for (const sample of samples) expectRefused(projectDrawingsInPart(parse(sample)));
  });

  test('bounds group member count and nesting before generating previews', () => {
    const child = '<v:rect style="left:100;top:200;width:1;height:1"/>';
    expectRefused(projectDrawingsInPart(parse(group(child.repeat(129)))));
    let nested = photo('left:0;top:0;width:10;height:10');
    for (let depth = 0; depth < 10; depth++) {
      nested = `<v:group style="left:0;top:0;width:10;height:10">${nested}</v:group>`;
    }
    expectRefused(projectDrawingsInPart(parse(group(nested))));
  });

  test('refuses groups whose members or arrow ink would be clipped by the viewport', () => {
    const outside = photo('left:50;top:200;width:500;height:250');
    const edgeArrow =
      '<v:shape type="#_x0000_t32" style="left:100;top:200;width:900;height:0" strokecolor="#ff0000" strokeweight="12pt"><v:stroke startarrow="block" endarrow="block"/></v:shape>';
    expectRefused(projectDrawingsInPart(parse(group(outside))));
    expectRefused(projectDrawingsInPart(parse(group(edgeArrow))));
  });

  test('treats the complete photo/arrow group as one offset and restores it on undo', () => {
    const part = parse(group());
    const before = serializeOoxmlPart(part);
    const paragraph = firstParagraph(part);
    const atom = segmentsOf(paragraph).find(
      (s) => s.node.kind !== 'textValue' && s.node.localName === 'pict'
    );
    expect(paragraphLength(paragraph)).toBe(3);
    expect(paragraphTextOf(part, paragraph.id)).toBe('A\uFFFCZ');
    expect(atom).toMatchObject({ start: 1, end: 2 });
    expect(atom?.removeNodeIds).toEqual([atom?.node.id]);
    const store = new TreeDocumentStore(part);
    expect(
      store.transact((ctx) =>
        ctx.apply({ op: 'deleteText', paragraphId: paragraph.id, start: 1, end: 2 })
      ).ok
    ).toBe(true);
    expect(paragraphTextOf(store.part, paragraph.id)).toBe('AZ');
    expectRefused(projectDrawingsInPart(store.part));
    expect(store.undo()).not.toBeNull();
    expect(serializeOoxmlPart(store.part)).toBe(before);
    expect(projectDrawingsInPart(store.part)).toHaveLength(1);
  });
});

describe('derived legacy graphics resources', () => {
  test('plain photos reuse validated raster resources and retain authored crops', async () => {
    const content = `<w:pict>${photo().replace('o:title="photo"', 'cropleft="8192f"')}</w:pict>`;
    const pkg = packageOf(content);
    const lookup = createImageResourceCache(pkg, { decodePort: decodePort() });
    try {
      const projection = projectDrawingsInPackage(pkg)[0]!;
      expect(projection.picture?.crop.left).toBe(0.125);
      expect(projection.legacyGraphic).toBeUndefined();
      const state = await lookup.resolveForProjection(projection);
      const original = await lookup.resolveEmbedded(projection.ownerPartName, 'rPhoto');
      expect(state).toBe(original);
      expect(state.kind === 'ready' && state.mime).toBe('image/png');
    } finally {
      lookup.dispose();
    }
  });

  test('invalidates colour-key previews without changing original XML or PNG bytes', async () => {
    const keyed = (key: string) =>
      `<w:pict>${photo().replace('o:title="photo"', `chromakey="${key}"`)}</w:pict>`;
    const pkg = packageOf(keyed('#ffffff'));
    const before = unzipSync(writeOoxmlPackage(pkg));
    const lookup = createImageResourceCache(pkg, { decodePort: decodePort() });
    try {
      const white = await lookup.resolveForProjection(onlyProjection(parse(keyed('#ffffff'))));
      if (white.kind !== 'ready') throw new Error('Expected white preview');
      const whitePaint = retainValidatedImageBytes(white.validatedHandle);
      const red = await lookup.resolveForProjection(onlyProjection(parse(keyed('#ff0000'))));
      expect(svgOf(white)).toContain('vml-key-ffffff');
      expect(svgOf(red)).toContain('vml-key-ff0000');
      expect(svgOf(white)).toContain(`data:image/png;base64,${PNG_BASE64}`);
      if (white.kind !== 'ready' || red.kind !== 'ready')
        throw new Error('Expected ready previews');
      expect(white.contentId).not.toBe(red.contentId);
      releaseValidatedImageBytesToken(whitePaint);
      expect(mintValidatedImageBytes(white.validatedHandle, white.contentId)).toBeNull();
      const after = unzipSync(writeOoxmlPackage(pkg));
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      for (const name of Object.keys(before)) expect(after[name]).toEqual(before[name]);
    } finally {
      lookup.dispose();
    }
  });

  test('enforces encoded, decoded, pixel and dimension budgets on derived SVG previews', async () => {
    for (const limits of [
      { maxEncodedBytes: 256 },
      { maxDecodedBytes: 64 },
      { maxPixels: 10 },
      { maxDimension: 100 },
    ]) {
      const pkg = packageOf(wordArt('x'.repeat(900)));
      const decode = decodePort();
      const lookup = createImageResourceCache(pkg, { decodePort: decode, limits });
      try {
        expect(await lookup.resolveForProjection(projectDrawingsInPackage(pkg)[0]!)).toMatchObject({
          kind: 'unrenderable',
          reason: 'resource-limit',
        });
        expect(decode.calls).toBe(0);
      } finally {
        lookup.dispose();
      }
    }
  });

  test('resolves validated embedded photo bytes and arrow paint in a single SVG', async () => {
    const pkg = packageOf(group());
    const decode = decodePort();
    const lookup = createImageResourceCache(pkg, { decodePort: decode });
    try {
      const projection = projectDrawingsInPackage(pkg)[0]!;
      const state = await lookup.resolveForProjection(projection);
      const svg = svgOf(state);
      expect(svg).toContain(`href="data:image/png;base64,${PNG_BASE64}"`);
      expect(svg).toContain('<polyline points="20,10 120,60"');
      expect(svg).toContain('<path d="M');
      expect(svg.indexOf('<image')).toBeLessThan(svg.indexOf('<polyline'));
      expect(decode.calls).toBe(1);
      expect(await lookup.resolveForProjection(projection)).toBe(state);
      expect(decode.calls).toBe(1);
    } finally {
      lookup.dispose();
    }
  });

  test('counts every photo member without counting vector annotations', () => {
    const pkg = packageOf(
      group(photo('left:200;top:250;width:10;height:10')) + `<w:pict>${photo()}</w:pict>`
    );
    expect(liveDrawingReferenceCount(pkg, '/word/media/photo.png')).toBe(3);
    expect(liveDrawingReferenceCount(pkg, '/word/media/missing.png')).toBe(0);
  });

  test('does not fetch or decode an external photo relationship', async () => {
    const pkg = packageOf(group(), true);
    const decode = decodePort();
    const lookup = createImageResourceCache(pkg, { decodePort: decode });
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('No external fetch is permitted');
    }) as typeof fetch;
    try {
      const state = await lookup.resolveForProjection(projectDrawingsInPackage(pkg)[0]!);
      expect(state.kind).toBe('external');
      expect(decode.calls).toBe(0);
    } finally {
      globalThis.fetch = fetchBefore;
      lookup.dispose();
    }
  });

  test('does not paint a partial group when a photo relationship is missing', async () => {
    const pkg = packageOf(group().replace('r:id="rPhoto"', 'r:id="missing"'));
    const decode = decodePort();
    const lookup = createImageResourceCache(pkg, { decodePort: decode });
    try {
      expect((await lookup.resolveForProjection(projectDrawingsInPackage(pkg)[0]!)).kind).toBe(
        'missing'
      );
      expect(decode.calls).toBe(0);
    } finally {
      lookup.dispose();
    }
  });

  test('invalidates generated resources when geometry or WordArt text changes', async () => {
    const pkg = packageOf(wordArt('Old'));
    const lookup = createImageResourceCache(pkg, { decodePort: decodePort() });
    try {
      const oldProjection = onlyProjection(parse(wordArt('Old')));
      const resizedProjection = onlyProjection(parse(wordArt('Old', '240pt')));
      const editedProjection = onlyProjection(parse(wordArt('New', '240pt')));
      expect(resizedProjection.drawingNodeId).toBe(oldProjection.drawingNodeId);
      expect(editedProjection.drawingNodeId).toBe(oldProjection.drawingNodeId);
      const oldState = await lookup.resolveForProjection(oldProjection);
      if (oldState.kind !== 'ready') throw new Error('Expected old preview');
      const oldPaint = retainValidatedImageBytes(oldState.validatedHandle);
      const resized = await lookup.resolveForProjection(resizedProjection);
      expect(svgOf(resized)).toContain('viewBox="0 0 240 30"');
      const edited = await lookup.resolveForProjection(editedProjection);
      expect(svgOf(oldState)).toContain('>Old</text>');
      expect(svgOf(edited)).toContain('>New</text>');
      if (oldState.kind !== 'ready' || resized.kind !== 'ready' || edited.kind !== 'ready')
        throw new Error('Expected ready resources');
      expect(resized.contentId).not.toBe(oldState.contentId);
      expect(edited.contentId).not.toBe(resized.contentId);
      // A new resource must not revoke a previously retained paint frame.
      expect(svgOf(oldState)).toContain('>Old</text>');
      releaseValidatedImageBytesToken(oldPaint);
      expect(mintValidatedImageBytes(oldState.validatedHandle, oldState.contentId)).toBeNull();
      expect(mintValidatedImageBytes(resized.validatedHandle, resized.contentId)).toBeNull();
    } finally {
      lookup.dispose();
    }
  });

  test('save/reopen keeps original media and adds no synthetic part or relationship', async () => {
    const pkg = packageOf(group() + wordArt());
    const before = unzipSync(writeOoxmlPackage(pkg));
    const documentBefore = serializeOoxmlPart(pkg.parts.get(pkg.mainDocumentPart)!);
    const lookup = createImageResourceCache(pkg, { decodePort: decodePort() });
    try {
      for (const projection of projectDrawingsInPackage(pkg))
        svgOf(await lookup.resolveForProjection(projection));
      const saved = writeOoxmlPackage(pkg);
      const after = unzipSync(saved);
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      expect(after['word/media/photo.png']).toEqual(PNG);
      expect(after['word/_rels/document.xml.rels']).toEqual(before['word/_rels/document.xml.rels']);
      expect(after['[Content_Types].xml']).toEqual(before['[Content_Types].xml']);
      const reopened = readOoxmlPackage(saved);
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(
        serializeOoxmlPart(reopened.package.parts.get(reopened.package.mainDocumentPart)!)
      ).toBe(documentBefore);
      expect(projectDrawingsInPackage(reopened.package)).toHaveLength(2);
    } finally {
      lookup.dispose();
    }
  });
});

const W10 = 'urn:schemas-microsoft-com:office:word';
const SIDES = ['top', 'left', 'bottom', 'right'] as const;

function borderedPhoto(
  options: {
    sides?: readonly string[];
    width?: (side: string) => string;
    color?: (side: string) => string | null;
    extra?: string;
    style?: string;
  } = {}
): string {
  const sides = options.sides ?? SIDES;
  const colors = sides
    .map((side) => {
      const value = options.color ? options.color(side) : 'black';
      return value === null ? '' : ` o:border${side}color="${value}"`;
    })
    .join('');
  const borders = sides
    .map(
      (side) =>
        `<w10:border${side} type="single" width="${options.width ? options.width(side) : '8'}"${options.extra ?? ''}/>`
    )
    .join('');
  return `<w:pict>${photo(options.style)
    .replace('id="photo"', `id="photo" xmlns:w10="${W10}"${colors}`)
    .replace('</v:shape>', `${borders}</v:shape>`)}</w:pict>`;
}

describe('legacy VML picture borders', () => {
  test('widens the drawing by the outline and keeps the authored picture frame and crop', () => {
    const part = parse(borderedPhoto().replace('o:title="photo"', 'cropleft="8192f"'));
    const before = serializeOoxmlPart(part);
    const projection = onlyProjection(part);
    expect(projection.kind).toBe('inline');
    expect(projection.extentEmu).toEqual({ cx: 74 * 12700, cy: 38 * 12700 });
    expect(projection.picture).toBeNull();
    expect(projection.legacyGraphic).toBeUndefined();
    expect(projection.groupPicture).toMatchObject({
      embeddedRelationshipId: 'rPhoto',
      linkedRelationshipId: null,
      crop: { left: 0.125, top: 0, right: 0, bottom: 0 },
      frameEmu: { x: 12700, y: 12700, cx: 914400, cy: 457200 },
      alternateContent: false,
    });
    const outline = projection.vectorShape!;
    expect(outline.extentEmu).toEqual({ cx: 74 * 12700, cy: 38 * 12700 });
    expect(outline.components).toHaveLength(1);
    expect(outline.components[0]).toMatchObject({
      fillHex: null,
      strokeHex: '000000',
      strokeWidthEmu: 12700,
      subpathsClosed: [true],
      subpathsEmu: [
        [
          { x: 6350, y: 6350 },
          { x: 74 * 12700 - 6350, y: 6350 },
          { x: 74 * 12700 - 6350, y: 38 * 12700 - 6350 },
          { x: 6350, y: 38 * 12700 - 6350 },
        ],
      ],
    });
    // One drawing atom between the two text characters, as for an unbordered picture.
    expect(paragraphLength(firstParagraph(part))).toBe(3);
    // A refused outline keeps the picture box as an unpainted placeholder atom.
    const partial = parse(borderedPhoto({ sides: ['top'] }));
    expect(paragraphLength(firstParagraph(partial))).toBe(3);
    expectRefused(projectDrawingsInPart(partial));
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test('reads the width in eighths of a point and a hex colour', () => {
    const projection = onlyProjection(
      parse(borderedPhoto({ width: () => '6', color: () => '#1F2E3D' }))
    );
    expect(projection.extentEmu).toEqual({ cx: 73.5 * 12700, cy: 37.5 * 12700 });
    expect(projection.groupPicture?.frameEmu).toEqual({
      x: 9525,
      y: 9525,
      cx: 914400,
      cy: 457200,
    });
    expect(projection.vectorShape?.components[0]).toMatchObject({
      strokeHex: '1F2E3D',
      strokeWidthEmu: 9525,
    });
  });

  test('refuses partial, mixed, unknown or unbounded border sides instead of dropping them', () => {
    const samples = [
      borderedPhoto({ sides: ['top'] }),
      borderedPhoto({ sides: ['left'] }),
      borderedPhoto({ sides: ['top', 'left', 'bottom'] }),
      borderedPhoto().replace('</v:shape>', '<w10:bordertop type="single" width="8"/></v:shape>'),
      borderedPhoto({ sides: ['top', 'left', 'bottom', 'middle'] }),
      borderedPhoto({ width: (side) => (side === 'left' ? '6' : '8') }),
      borderedPhoto({ color: (side) => (side === 'right' ? 'red' : 'black') }),
      borderedPhoto({ color: (side) => (side === 'top' ? null : 'black') }),
      borderedPhoto({ color: () => 'this' }),
      borderedPhoto({ width: () => '0' }),
      borderedPhoto({ width: () => '97' }),
      borderedPhoto({ width: () => '1.5' }),
      borderedPhoto({ width: () => '' }),
      borderedPhoto({ extra: ' shadow="t"' }),
      borderedPhoto().replaceAll('type="single"', 'type="double"'),
      borderedPhoto().replace(
        'type="single" width="8"/>',
        'type="single" width="8"><w10:x/></w10:bordertop>'
      ),
      borderedPhoto({ style: 'position:absolute;width:72pt;height:36pt' }),
      borderedPhoto().replace('o:title="photo"', 'chromakey="#ffffff"'),
    ];
    for (const sample of samples) {
      const part = parse(sample);
      const before = serializeOoxmlPart(part);
      expectRefused(projectDrawingsInPart(part));
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });

  test('keeps refusing outlines on shapes that are not a standalone picture', () => {
    const borders = SIDES.map((side) => `<w10:border${side} type="single" width="8"/>`).join('');
    const colors = SIDES.map((side) => ` o:border${side}color="black"`).join('');
    const member = photo('left:200;top:250;width:500;height:250')
      .replace('id="photo"', `id="photo" xmlns:w10="${W10}"${colors}`)
      .replace('</v:shape>', `${borders}</v:shape>`);
    const rect = `<w:pict><v:rect xmlns:w10="${W10}" style="width:72pt;height:36pt"${colors}>${borders}</v:rect></w:pict>`;
    for (const sample of [
      `<w:pict><v:group style="width:200pt;height:100pt" coordorigin="100,200" coordsize="1000,500">${member}</v:group></w:pict>`,
      rect,
      wordArt()
        .replace('stroked="f">', `stroked="f" xmlns:w10="${W10}"${colors}>`)
        .replace('</v:shape>', `${borders}</v:shape>`),
    ])
      expectRefused(projectDrawingsInPart(parse(sample)));
  });

  test('resolves the outlined picture through the validated raster path', async () => {
    const pkg = packageOf(borderedPhoto());
    const decode = decodePort();
    const lookup = createImageResourceCache(pkg, { decodePort: decode });
    try {
      const projection = projectDrawingsInPackage(pkg)[0]!;
      const state = await lookup.resolveForProjection(projection);
      expect(state).toBe(await lookup.resolveEmbedded(projection.ownerPartName, 'rPhoto'));
      expect(state.kind === 'ready' && state.mime).toBe('image/png');
      expect(decode.calls).toBe(1);
      expect(liveDrawingReferenceCount(pkg, '/word/media/photo.png')).toBe(1);
    } finally {
      lookup.dispose();
    }
  });
});

describe('plain legacy rectangles and ovals', () => {
  const EMU = 12_700;
  const shapeOf = (content: string) => onlyProjection(parse(`<w:pict>${content}</w:pict>`));

  test('project as a vector shape over the box the preview covered', () => {
    const projection = shapeOf('<v:rect id="mask" style="width:60pt;height:40pt" stroked="f"/>');
    expect(projection.legacyGraphic).toBeUndefined();
    const shape = projection.vectorShape!;
    expect(shape.extentEmu).toEqual({ cx: 60 * EMU, cy: 40 * EMU });
    // A rectangle with no fill color paints white; this one has no outline.
    expect(shape.components[0]).toMatchObject({ fillHex: 'FFFFFF', strokeHex: null });
    const xs = shape.components[0]!.subpathsEmu.flat().map((point) => point.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 60 * EMU]);
  });

  test('keep the outline inside the widened box and round the corners', () => {
    const shape = shapeOf(
      '<v:roundrect id="r" style="width:60pt;height:40pt" arcsize="0.5" fillcolor="#ff0000" strokecolor="#0000ff" strokeweight="2pt"/>'
    ).vectorShape!;
    // The outline reaches 1pt past each side, so the box grows by 2pt.
    expect(shape.extentEmu).toEqual({ cx: 62 * EMU, cy: 42 * EMU });
    expect(shape.components[0]).toMatchObject({
      fillHex: 'FF0000',
      strokeHex: '0000FF',
      strokeWidthEmu: 2 * EMU,
    });
    const points = shape.components[0]!.subpathsEmu.flat();
    expect(Math.min(...points.map((point) => point.x))).toBe(EMU);
    // A rounded corner keeps no point at the box corner itself.
    expect(points.some((point) => point.x === EMU && point.y === EMU)).toBe(false);
  });

  test('flatten an oval inside its box', () => {
    const shape = shapeOf(
      '<v:oval id="o" style="width:40pt;height:20pt" fillcolor="#00ff00" stroked="f"/>'
    ).vectorShape!;
    const points = shape.components[0]!.subpathsEmu.flat();
    expect(points.length).toBeGreaterThan(8);
    for (const point of points) {
      const nx = (point.x - 20 * EMU) / (20 * EMU),
        ny = (point.y - 10 * EMU) / (10 * EMU);
      expect(nx * nx + ny * ny).toBeLessThan(1.01);
    }
  });
});
