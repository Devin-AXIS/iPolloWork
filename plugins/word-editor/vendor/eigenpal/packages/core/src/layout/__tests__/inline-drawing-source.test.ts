import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type ImageResourceLookup,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { zipSync, strToU8 } from 'fflate';
import { indexInlineDrawingProjectionsInPart } from '../../store/package/drawing-projection.ts';
import {
  createInlineDrawingLayoutBundle,
  drawingAtomIdentities,
  drawingTokenForTableBlock,
  drawingTokenForTableBlockMemo,
  drawingProjectionLayoutToken,
  vectorShapeLayoutToken,
} from '../inline-drawing-source.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

test('part-wide drawing identity scan does not fail closed after 4k elements', () => {
  const prefix = Array.from({ length: 5_000 }, () => '<w:p/>').join('');
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}"><w:body>${prefix}<w:p><w:r><w:drawing>` +
      '<wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></w:r></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);

  const atoms = drawingAtomIdentities(result.part);

  expect(atoms).not.toBeNull();
});

test('a slot hit resolves no package; a substrate change through sync still does', () => {
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  let pkg = loaded.package;
  let revision = 0;
  let packageReads = 0;
  const session = {
    packageRevision: () => revision,
    currentPackage: () => {
      packageReads += 1;
      return pkg;
    },
    part: () => pkg.parts.get(pkg.mainDocumentPart)!,
  };
  const resourceLookup: ImageResourceLookup = {
    resolveEmbedded: async () => Object.freeze({ kind: 'missing' as const }),
    resolveLinked: () => Object.freeze({ kind: 'missing' as const }),
    resolveForProjection: async () => Object.freeze({ kind: 'missing' as const }),
    liveReferenceCount: () => 0,
    dispose: () => {},
  };
  const bundle = createInlineDrawingLayoutBundle({
    session,
    decodePort: Object.freeze({
      decode: async () => {
        throw new Error('unused');
      },
    }),
    resourceLookup,
    onResourcesChanged: () => {},
  });
  const paragraph = session
    .part()
    .root.children.find((node) => node.kind !== 'textValue' && node.localName === 'body')!;
  const body = paragraph.kind === 'textValue' ? null : paragraph;
  const firstParagraph = body!.children.find((node) => node.kind === 'paragraph')!;
  if (firstParagraph.kind === 'textValue') throw new Error('unexpected text node');

  bundle.drawingTokenForParagraph(firstParagraph, session.part().name);
  const afterFirst = packageReads;
  bundle.drawingTokenForParagraph(firstParagraph, session.part().name);
  bundle.drawingTokenForParagraph(firstParagraph, session.part().name);
  // The slot map answers repeat lookups; layout keys every paragraph through here, so a
  // hit must not pay a package snapshot per call.
  expect(packageReads).toBe(afterFirst);

  pkg = Object.freeze({ ...pkg, parts: new Map(pkg.parts) });
  revision += 1;
  bundle.sync(session);
  // Compatibility after a package move stays resetPackage's job — sync must still read.
  expect(packageReads).toBeGreaterThan(afterFirst);
});

// ── drawingTokenForTableBlockMemo ─────────────────────────────────────────────────────────
// The table token exists to VALIDATE the table's prepared-block memo, so it used to be
// recomputed (a full row/cell walk) before every hit. The memo keys on (immutable table
// node, drawingLayoutEpoch); an undefined epoch means the caller cannot see resource moves,
// so that path must stay a recompute.

/** A table whose first cell paragraph carries an inline drawing; the second is plain text. */
function tableWithDrawing(): OoxmlNode {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}"><w:body><w:tbl>` +
      '<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:drawing>' +
      '<wp:inline><wp:extent cx="914400" cy="914400"/></wp:inline></w:drawing></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  );
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const table = body.children.find((node) => node.kind === 'table');
  if (!table) throw new Error('no table');
  return table;
}

/** Whether a paragraph subtree contains a `w:drawing` — the shape a real token fn keys on. */
function paragraphHasDrawing(paragraph: OoxmlNode): boolean {
  if (paragraph.kind === 'textValue') return false;
  if (paragraph.localName === 'drawing') return true;
  return paragraph.children.some((child) => paragraphHasDrawing(child));
}

function countedTokenFn(): { fn: (paragraph: OoxmlNode) => string; calls: () => number } {
  let calls = 0;
  return {
    fn: (paragraph) => {
      calls += 1;
      return paragraphHasDrawing(paragraph) ? `drawing@${paragraph.id}` : '';
    },
    calls: () => calls,
  };
}

// The aggregate is a CACHE VALIDATOR: two different paragraph-to-token assignments over one
// byte-identical subtree must never produce one string, or the prepared-block memo serves a
// break with stale drawing layout. `tableWithDrawing` has exactly two cell paragraphs.
test('two different paragraph-to-token assignments never alias', () => {
  const table = tableWithDrawing();
  const firstOnly = drawingTokenForTableBlock(table, (paragraph) =>
    paragraphHasDrawing(paragraph) ? 'X' : ''
  );
  const secondOnly = drawingTokenForTableBlock(table, (paragraph) =>
    paragraphHasDrawing(paragraph) ? '' : 'X'
  );
  expect(firstOnly).not.toBe(secondOnly);
});

test('a separator inside a token value cannot shift a slot boundary', () => {
  const table = tableWithDrawing();
  const boundaryInFirst = drawingTokenForTableBlock(table, (paragraph) =>
    paragraphHasDrawing(paragraph) ? 'a;b' : 'c'
  );
  const boundaryInSecond = drawingTokenForTableBlock(table, (paragraph) =>
    paragraphHasDrawing(paragraph) ? 'a' : 'b;c'
  );
  expect(boundaryInFirst).not.toBe(boundaryInSecond);
});

test('a table with no drawing tokens aggregates to the empty string', () => {
  const table = tableWithDrawing();
  expect(drawingTokenForTableBlock(table, () => '')).toBe('');
});

test('memoized table drawing token equals a direct recompute under a fixed epoch', () => {
  const table = tableWithDrawing();
  const memoSide = countedTokenFn();
  const directSide = countedTokenFn();

  const memoized = drawingTokenForTableBlockMemo(table, 'epoch-1', memoSide.fn);
  const direct = drawingTokenForTableBlock(table, directSide.fn);
  expect(memoized).toBe(direct);
  expect(memoized).toContain('drawing@');
  // Both sides walked every paragraph of the subtree exactly once.
  expect(memoSide.calls()).toBe(directSide.calls());
});

test('same node and same epoch answers from the cache without re-walking', () => {
  const table = tableWithDrawing();
  const counted = countedTokenFn();

  const first = drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  const walkCost = counted.calls();
  expect(walkCost).toBeGreaterThan(0);

  const second = drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  expect(second).toBe(first);
  expect(counted.calls()).toBe(walkCost);
});

test('an epoch change recomputes', () => {
  const table = tableWithDrawing();
  const counted = countedTokenFn();

  const first = drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  const walkCost = counted.calls();

  const second = drawingTokenForTableBlockMemo(table, 'epoch-2', counted.fn);
  expect(second).toBe(first);
  expect(counted.calls()).toBe(walkCost * 2);

  // The recompute re-armed the cache under the new epoch.
  drawingTokenForTableBlockMemo(table, 'epoch-2', counted.fn);
  expect(counted.calls()).toBe(walkCost * 2);
});

test('an undefined epoch always recomputes and never reads or arms the cache', () => {
  const table = tableWithDrawing();
  const counted = countedTokenFn();

  drawingTokenForTableBlockMemo(table, undefined, counted.fn);
  const walkCost = counted.calls();
  drawingTokenForTableBlockMemo(table, undefined, counted.fn);
  expect(counted.calls()).toBe(walkCost * 2);

  // Nothing was armed: the first epoch-carrying call still pays a walk.
  drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  expect(counted.calls()).toBe(walkCost * 3);

  // A warm epoch entry does not leak into the epoch-free path either.
  drawingTokenForTableBlockMemo(table, undefined, counted.fn);
  expect(counted.calls()).toBe(walkCost * 4);
});

// `vectorShapeLayoutToken` is a DIGEST, not a serialization: it is what stops
// `isCompatibleWith` from paying ~48 KB of `JSON.stringify` per shape per atom. A digest is
// only worth having if it still separates shapes that differ, so each case below changes one
// field and nothing else.
describe('vector shape layout token', () => {
  const point = (x: number, y: number) => Object.freeze({ x, y });
  const shape = (
    overrides: Partial<{
      readonly points: readonly Readonly<{ x: number; y: number }>[];
      readonly fillHex: string | null;
      readonly fillAlpha: number;
      readonly strokeHex: string | null;
      readonly strokeAlpha: number;
      readonly strokeWidthEmu: number;
      readonly cx: number;
      readonly extraComponent: boolean;
      readonly splitSubpaths: boolean;
      readonly splitAt: number;
      readonly open: boolean;
      readonly arrowheads: readonly (readonly Readonly<{ x: number; y: number }>[])[];
    }> = {}
  ) => {
    const points = overrides.points ?? [point(0, 0), point(100, 0), point(100, 50.5)];
    const subpathsEmu =
      overrides.splitAt !== undefined
        ? [points.slice(0, overrides.splitAt), points.slice(overrides.splitAt)]
        : overrides.splitSubpaths
          ? [points.slice(0, 1), points.slice(1)]
          : [points];
    const component = {
      subpathsEmu,
      ...(overrides.open ? { subpathsClosed: subpathsEmu.map(() => false) } : {}),
      ...(overrides.arrowheads ? { arrowheadsEmu: overrides.arrowheads } : {}),
      fillHex: overrides.fillHex === undefined ? '4472C4' : overrides.fillHex,
      fillAlpha: overrides.fillAlpha ?? 1,
      strokeHex: overrides.strokeHex ?? null,
      strokeAlpha: overrides.strokeAlpha ?? 1,
      strokeWidthEmu: overrides.strokeWidthEmu ?? 0,
    };
    return {
      extentEmu: { cx: overrides.cx ?? 1000, cy: 500 },
      subpathsEmu: component.subpathsEmu,
      fillHex: component.fillHex,
      fillAlpha: component.fillAlpha,
      strokeHex: component.strokeHex,
      strokeAlpha: component.strokeAlpha,
      strokeWidthEmu: component.strokeWidthEmu,
      components: overrides.extraComponent
        ? [component, { ...component, fillHex: 'FF0000' }]
        : [component],
    };
  };

  // The point stream and the subpath COUNT are both equal here, so only the per-subpath
  // length in the token separates them: 8 points split [3,5] against the same 8 split [4,4]
  // produce identical FNV accumulators.
  test('two subpaths of the same points split at a different index differ', () => {
    const points = Array.from({ length: 8 }, (_, index) => point(index * 11, index * 7.25));
    expect(vectorShapeLayoutToken(shape({ points, splitAt: 3 }))).not.toBe(
      vectorShapeLayoutToken(shape({ points, splitAt: 4 }))
    );
  });

  test('equal shapes agree and each single difference separates them', () => {
    const baseline = vectorShapeLayoutToken(shape());
    expect(vectorShapeLayoutToken(shape())).toBe(baseline);
    const differences = {
      'a moved point': shape({ points: [point(0, 0), point(100, 0), point(100, 50.6)] }),
      'a sub-unit move': shape({ points: [point(0, 0), point(100, 0), point(100, 50.5001)] }),
      'a swapped x and y': shape({ points: [point(0, 0), point(0, 100), point(100, 50.5)] }),
      'a reordered point': shape({ points: [point(100, 0), point(0, 0), point(100, 50.5)] }),
      'a dropped point': shape({ points: [point(0, 0), point(100, 0)] }),
      'the same points in two subpaths': shape({ splitSubpaths: true }),
      'a different fill': shape({ fillHex: '4472C5' }),
      'no fill': shape({ fillHex: null }),
      'a different fill opacity': shape({ fillAlpha: 0.5 }),
      'a stroke': shape({ strokeHex: '000000' }),
      'a stroke opacity': shape({ strokeAlpha: 0.5 }),
      'a stroke width': shape({ strokeWidthEmu: 12_700 }),
      'a different extent': shape({ cx: 1001 }),
      'a second component': shape({ extraComponent: true }),
      'an open subpath': shape({ open: true }),
      'a line-end triangle': shape({ arrowheads: [[point(0, 0), point(5, 5), point(-5, 5)]] }),
    };
    for (const [label, changed] of Object.entries(differences)) {
      expect(`${label} collides: ${vectorShapeLayoutToken(changed) === baseline}`).toBe(
        `${label} collides: false`
      );
    }
  });

  // A cap or join changes the painted outline and its ink clip without moving any point,
  // so a reused record would keep painting the old line ends.
  test('line caps and joins separate otherwise equal shapes', () => {
    const open = shape({ open: true, strokeHex: '000000', strokeWidthEmu: 12_700 });
    const styled = (fields: {
      strokeCap?: 'butt' | 'round' | 'square';
      strokeJoin?: 'round' | 'bevel';
    }) => ({
      ...open,
      components: [{ ...open.components[0]!, ...fields }],
    });
    const tokens = [
      open,
      styled({ strokeCap: 'butt' }),
      styled({ strokeCap: 'round' }),
      styled({ strokeCap: 'square' }),
      styled({ strokeJoin: 'round' }),
      styled({ strokeJoin: 'bevel' }),
    ].map(vectorShapeLayoutToken);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  test('line-end triangles separate by count and by vertex', () => {
    const one = shape({ arrowheads: [[point(0, 0), point(5, 5), point(-5, 5)]] });
    const moved = shape({ arrowheads: [[point(0, 0), point(5, 5), point(-5, 5.5)]] });
    const two = shape({
      arrowheads: [
        [point(0, 0), point(5, 5), point(-5, 5)],
        [point(100, 50.5), point(95, 45), point(105, 45)],
      ],
    });
    expect(vectorShapeLayoutToken(one)).toBe(vectorShapeLayoutToken(one));
    expect(vectorShapeLayoutToken(moved)).not.toBe(vectorShapeLayoutToken(one));
    expect(vectorShapeLayoutToken(two)).not.toBe(vectorShapeLayoutToken(one));
  });

  // Projected from markup rather than hand-built: `a:close` and a centred `a:tailEnd` move no vertex
  // of the authored path, so only the close flags and the generated end can tell the
  // shapes apart. A token blind to either reuses a stale record across the edit.
  test('projections that differ only by a close command or a line end differ', () => {
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
    const project = (options: { close?: boolean; tailEnd?: boolean }) => {
      const xml =
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"><w:body><w:p><w:r>` +
        '<w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="c"/>' +
        `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:spPr>` +
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>' +
        '<a:custGeom><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
        '<a:lnTo><a:pt x="1000" y="1000"/></a:lnTo><a:lnTo><a:pt x="0" y="1000"/></a:lnTo>' +
        `${options.close ? '<a:close/>' : ''}</a:path></a:pathLst></a:custGeom>` +
        '<a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>' +
        `${options.tailEnd ? '<a:tailEnd type="oval"/>' : ''}</a:ln>` +
        '</wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>' +
        '</w:r></w:p></w:body></w:document>';
      const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
      if (!parsed.ok) throw new Error(parsed.reason);
      const projections = [...indexInlineDrawingProjectionsInPart(parsed.part).values()];
      expect(projections).toHaveLength(1);
      const vector = projections[0]!.vectorShape;
      if (!vector) throw new Error('expected a vector shape projection');
      return vector;
    };
    const open = project({});
    const closed = project({ close: true });
    const arrow = project({ tailEnd: true });
    expect(closed.components[0]!.subpathsEmu).toEqual(open.components[0]!.subpathsEmu);
    expect(arrow.components[0]!.subpathsEmu).toEqual(open.components[0]!.subpathsEmu);
    expect(vectorShapeLayoutToken(project({}))).toBe(vectorShapeLayoutToken(open));
    expect(vectorShapeLayoutToken(closed)).not.toBe(vectorShapeLayoutToken(open));
    expect(vectorShapeLayoutToken(arrow)).not.toBe(vectorShapeLayoutToken(open));
  });

  test('a moved wrap polygon vertex or a flipped anchor flag separates the drawing token', () => {
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const project = (options: { vertexX?: number; allowOverlap?: boolean; behind?: boolean }) => {
      const xml =
        `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
        `<wp:anchor simplePos="0" behindDoc="${options.behind ? 1 : 0}" layoutInCell="1" allowOverlap="${options.allowOverlap === false ? 0 : 1}" locked="0" relativeHeight="1">` +
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="1270000" cy="635000"/><wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0">' +
        `<wp:start x="0" y="0"/><wp:lineTo x="${options.vertexX ?? 21600}" y="0"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="0" y="0"/>` +
        '</wp:wrapPolygon></wp:wrapTight><wp:docPr id="1" name="p"/>' +
        `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr>` +
        '<pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic>' +
        '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>';
      const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
      if (!parsed.ok) throw new Error(parsed.reason);
      const projections = [...indexInlineDrawingProjectionsInPart(parsed.part).values()];
      expect(projections).toHaveLength(1);
      return projections[0]!;
    };
    const base = drawingProjectionLayoutToken(project({}));
    expect(drawingProjectionLayoutToken(project({}))).toBe(base);
    expect(drawingProjectionLayoutToken(project({ vertexX: 10000 }))).not.toBe(base);
    expect(drawingProjectionLayoutToken(project({ allowOverlap: false }))).not.toBe(base);
    expect(drawingProjectionLayoutToken(project({ behind: true }))).not.toBe(base);
  });

  test('the token stays small for a shape at the point budget', () => {
    const points = Array.from({ length: 1024 }, (_, index) =>
      point(index * 37.5, (index * 53) % 100_000)
    );
    const token = vectorShapeLayoutToken(shape({ points }));
    // `JSON.stringify` of the same shape is ~48 KB. Anything near that is the regression.
    expect(token.length).toBeLessThan(200);
  });
});

// A theme swap has to invalidate the drawing slot.
//
// `isCompatibleWith` short-circuits on `nextPart === part`, which is true whenever only
// `theme1.xml` or `settings.xml` moved — the document part is untouched. Without the
// `cacheToken` comparison ahead of that short-circuit, every drawing keeps the colours the
// OLD theme resolved and nothing is left to invalidate them for the rest of the session.
test('a theme-part swap refuses the slot even though the document part is identical', () => {
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const THEME_PART = '/word/theme/theme1.xml';

  const themeXml = (accent1: string) =>
    `<a:theme xmlns:a="${A}" name="T"><a:themeElements><a:clrScheme name="T">` +
    `<a:accent1><a:srgbClr val="${accent1}"/></a:accent1>` +
    '</a:clrScheme></a:themeElements></a:theme>';

  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="${THEME_PART}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/theme/theme1.xml': strToU8(themeXml('6F55D7')),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
        '<w:body><w:p><w:r><w:drawing>' +
        '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="457200" cy="457200"/><wp:docPr id="1" name="Rect"/>' +
        `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
        '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln>' +
        '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  let pkg = loaded.package;
  // The document part object never changes; only the theme part does.
  const documentPart = pkg.parts.get(pkg.mainDocumentPart)!;
  let revision = 0;
  const session = {
    packageRevision: () => revision,
    currentPackage: () => pkg,
    part: () => documentPart,
  };
  const resourceLookup: ImageResourceLookup = {
    resolveEmbedded: async () => Object.freeze({ kind: 'missing' as const }),
    resolveLinked: () => Object.freeze({ kind: 'missing' as const }),
    resolveForProjection: async () => Object.freeze({ kind: 'missing' as const }),
    liveReferenceCount: () => 0,
    dispose: () => {},
  };
  const bundle = createInlineDrawingLayoutBundle({
    session,
    decodePort: Object.freeze({
      decode: async () => {
        throw new Error('unused');
      },
    }),
    resourceLookup,
    onResourcesChanged: () => {},
  });

  const atomId = [...(drawingAtomIdentities(documentPart)?.keys() ?? [])][0]!;
  const fill = () => bundle.bodyContext.projectionForAtom?.(atomId)?.vectorShape?.fillHex ?? null;
  expect(fill()).toBe('6F55D7');

  const swapped = readOoxmlPart(themeXml('79C9B1'), {
    name: THEME_PART,
    contentType: 'application/vnd.openxmlformats-officedocument.theme+xml',
  });
  if (!swapped.ok) throw new Error(swapped.reason);
  // Only the theme part moves: `partBytes`, `relationships` and `contentTypes` keep their
  // identity, so `resetPackage` takes the substrate-unchanged path and asks the slot.
  pkg = Object.freeze({ ...pkg, parts: new Map(pkg.parts).set(THEME_PART, swapped.part) });
  revision += 1;
  bundle.sync(session);

  expect(fill()).toBe('79C9B1');
});

// Tree edits retain the package resource substrate. The slot must still replace projections
// when drawing spacing, textbox properties, or hosted text changes.
describe('drawing slot invalidation after tree edits', () => {
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const owner = '/word/document.xml';

  for (const edit of [
    'distance',
    'inset',
    'anchor',
    'text',
    'title',
    'lock',
    'brightness',
    'fill',
    'diagnostic',
  ] as const) {
    test(`refreshes the retained projection after a ${edit} edit`, () => {
      const isPicture = edit === 'brightness' || edit === 'fill';
      const hasTextbox = !isPicture && edit !== 'diagnostic';
      const graphic =
        edit === 'diagnostic'
          ? '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphicData></a:graphic>'
          : isPicture
            ? `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
              '<pic:nvPicPr><pic:cNvPr id="1" name="picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
              `<pic:blipFill><a:blip xmlns:r="${R}" r:embed="rIdImage"><a:lum bright="0" contrast="0"/></a:blip><a:stretch/></pic:blipFill>` +
              '<pic:spPr/></pic:pic></a:graphicData></a:graphic>'
            : `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:spPr>` +
              '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>' +
              '<a:prstGeom prst="rect"/><a:noFill/></wps:spPr>' +
              '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Before</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
              '<wps:bodyPr lIns="91440" anchor="t"/></wps:wsp></a:graphicData></a:graphic>';
      const loaded = readOoxmlPackage(
        zipSync({
          '[Content_Types].xml': strToU8(
            `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
              `<Override PartName="${owner}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
          ),
          '_rels/.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
          ),
          'word/document.xml': strToU8(
            `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"><w:body><w:p><w:r><w:drawing>` +
              '<wp:inline distL="0"><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="box" title="Before"/>' +
              '<wp:cNvGraphicFramePr><a:graphicFrameLocks noResize="0"/></wp:cNvGraphicFramePr>' +
              graphic +
              '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
          ),
        })
      );
      if (!loaded.ok) throw new Error(loaded.reason);
      let pkg = loaded.package;
      let revision = 0;
      const session = {
        packageRevision: () => revision,
        currentPackage: () => pkg,
        part: () => pkg.parts.get(owner)!,
      };
      const resourceLookup: ImageResourceLookup = {
        resolveEmbedded: async () => ({ kind: 'missing' }),
        resolveLinked: () => ({ kind: 'missing' }),
        resolveForProjection: async () => ({ kind: 'missing' }),
        liveReferenceCount: () => 0,
        dispose: () => {},
      };
      const bundle = createInlineDrawingLayoutBundle({
        session,
        decodePort: {
          decode: async () => {
            throw new Error('unused');
          },
        },
        resourceLookup,
        onResourcesChanged: () => {},
      });
      const atomId = [...drawingAtomIdentities(session.part())!.keys()][0]!;
      const before = bundle.bodyContext.projectionForAtom!(atomId)!;
      if (hasTextbox) expect(before.textboxStory).not.toBeNull();
      const beforeToken = drawingProjectionLayoutToken(before);
      const change = (node: OoxmlNode): OoxmlNode => {
        if (node.kind === 'textValue') {
          return edit === 'text' && node.value === 'Before' ? { ...node, value: 'After' } : node;
        }
        if (edit === 'diagnostic' && node.localName === 'graphic')
          return { ...node, kind: 'generic', localName: 'unsupportedGraphic' } as OoxmlNode;
        if (edit === 'fill' && node.localName === 'stretch')
          return { ...node, kind: 'pictureTile', localName: 'tile' } as OoxmlNode;
        const attributes = node.attributes.map((attr) => {
          const value =
            edit === 'distance' && node.localName === 'inline' && attr.localName === 'distL'
              ? '127000'
              : edit === 'inset' && node.localName === 'bodyPr' && attr.localName === 'lIns'
                ? '127000'
                : edit === 'anchor' && node.localName === 'bodyPr' && attr.localName === 'anchor'
                  ? 'b'
                  : edit === 'title' && node.localName === 'docPr' && attr.localName === 'title'
                    ? 'After'
                    : edit === 'lock' &&
                        node.localName === 'graphicFrameLocks' &&
                        attr.localName === 'noResize'
                      ? '1'
                      : edit === 'brightness' &&
                          node.localName === 'lum' &&
                          attr.localName === 'bright'
                        ? '50000'
                        : attr.value;
          return value === attr.value ? attr : { ...attr, value };
        });
        const children = node.children.map(change);
        if (
          attributes.every((attr, index) => attr === node.attributes[index]) &&
          children.every((child, index) => child === node.children[index])
        )
          return node;
        return { ...node, attributes, children } as OoxmlNode;
      };
      const part = session.part();
      const nextPart = { ...part, root: change(part.root) as typeof part.root };
      pkg = { ...pkg, parts: new Map(pkg.parts).set(owner, nextPart) };
      revision += 1;
      bundle.sync(session);
      const after = bundle.bodyContext.projectionForAtom!(atomId)!;
      const expected = indexInlineDrawingProjectionsInPart(nextPart).get(atomId)!;
      expect(after).toEqual(expected);
      expect(drawingProjectionLayoutToken(after)).not.toBe(beforeToken);
      // Property edits preserve the content root; their own token fields must invalidate.
      if (edit !== 'text' && hasTextbox)
        expect(after.textboxStory!.content).toBe(before.textboxStory!.content);
      bundle.dispose();
    });
  }
});
