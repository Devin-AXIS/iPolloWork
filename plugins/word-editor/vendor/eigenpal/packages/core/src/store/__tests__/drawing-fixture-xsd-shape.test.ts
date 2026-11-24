// ECMA XSD-shape oracles for deterministic drawing fixtures (Word compatibility gate).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type OoxmlElement, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { schemaAttributeValue } from '../package/ooxml-drawing-rules.ts';
import { validateRasterHeader } from '../package/image-resources.ts';
import { IMAGE_RELATIONSHIP_TYPE } from '../package/relationships.ts';

const FIXTURES_DIR = resolve(import.meta.dir, '../../../../../e2e/fixtures');
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const GENERATED_PICTURE_FIXTURES = [
  'images-external.docx',
  'images-wrap-sides.docx',
  'images-crop.docx',
  'images-zorder.docx',
  'images-formats.docx',
  'images-tiff.docx',
  'images-header.docx',
  'images-transform.docx',
  'images-compatibility-malformed.docx',
  'images-drawingml-watermark.docx',
] as const;

const GENERATED_RASTER_FIXTURES = GENERATED_PICTURE_FIXTURES.filter(
  (file) => file !== 'images-external.docx'
);

function openFixture(name: string) {
  const result = readOoxmlPackage(new Uint8Array(readFileSync(resolve(FIXTURES_DIR, name))));
  if (!result.ok) throw new Error(`${name}: ${result.reason}`);
  return result.package;
}

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children) yield* walk(child);
}

function findAll(root: OoxmlNode, kind: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const node of walk(root)) {
    if (node.kind === kind) found.push(node);
  }
  return found;
}

function genericChild(parent: OoxmlElement, localName: string, namespaceUri: string): OoxmlElement {
  const child = parent.children.find(
    (node) =>
      node.kind === 'generic' && node.localName === localName && node.namespaceUri === namespaceUri
  );
  if (!child || child.kind !== 'generic') {
    throw new Error(`missing ${localName} under ${parent.localName}`);
  }
  return child;
}

function relAttribute(node: OoxmlElement, localName: 'embed' | 'link'): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === R
  )?.value;
}

function assertPictureXsdShape(picture: OoxmlElement): void {
  expect(picture.kind).toBe('picture');
  const typed = picture.children.filter((child) => child.kind !== 'generic');
  expect(typed.map((child) => child.kind)).toEqual([
    'pictureNvPicPr',
    'pictureBlipFill',
    'pictureShapeProperties',
  ]);

  const nvPicPr = typed[0] as OoxmlElement;
  expect(nvPicPr.localName).toBe('nvPicPr');
  expect(nvPicPr.children).toHaveLength(2);
  const cNvPr = genericChild(nvPicPr, 'cNvPr', PIC);
  expect(schemaAttributeValue(cNvPr.attributes, 'id')).toMatch(/^\d+$/);
  expect(schemaAttributeValue(cNvPr.attributes, 'name')).toBeDefined();
  genericChild(nvPicPr, 'cNvPicPr', PIC);

  const blipFill = typed[1] as OoxmlElement;
  expect(blipFill.localName).toBe('blipFill');
  const blip = blipFill.children.find((child) => child.kind === 'pictureBlip');
  expect(blip).toBeDefined();
  expect(
    relAttribute(blip as OoxmlElement, 'embed') !== undefined ||
      relAttribute(blip as OoxmlElement, 'link') !== undefined
  ).toBe(true);
  expect(blipFill.children.some((child) => child.kind === 'pictureStretch')).toBe(true);

  const spPr = typed[2] as OoxmlElement;
  expect(spPr.localName).toBe('spPr');
  expect(spPr.children.some((child) => child.kind === 'pictureTransform')).toBe(true);
  expect(spPr.children.some((child) => child.kind === 'picturePresetGeometry')).toBe(true);
}

function assertInlineXsdShape(inline: OoxmlElement): void {
  expect(inline.localName).toBe('inline');
  expect(schemaAttributeValue(inline.attributes, 'distT')).toBeDefined();
  expect(schemaAttributeValue(inline.attributes, 'distB')).toBeDefined();
  expect(schemaAttributeValue(inline.attributes, 'distL')).toBeDefined();
  expect(schemaAttributeValue(inline.attributes, 'distR')).toBeDefined();
  expect(inline.children.some((child) => child.kind === 'drawingExtent')).toBe(true);
  expect(inline.children.some((child) => child.kind === 'drawingDocPr')).toBe(true);
  expect(inline.children.some((child) => child.kind === 'drawingGraphicFramePr')).toBe(true);
  const graphic = inline.children.find((child) => child.kind === 'drawingGraphic') as
    OoxmlElement | undefined;
  expect(graphic).toBeDefined();
  const graphicData = graphic!.children.find((child) => child.kind === 'drawingGraphicData') as
    OoxmlElement | undefined;
  expect(graphicData).toBeDefined();
  expect(schemaAttributeValue(graphicData!.attributes, 'uri')).toBe(PIC_URI);
  const picture = graphicData!.children.find((child) => child.kind === 'picture') as
    OoxmlElement | undefined;
  if (picture) assertPictureXsdShape(picture);
}

function assertAnchorXsdShape(anchor: OoxmlElement): void {
  for (const name of [
    'distT',
    'distB',
    'distL',
    'distR',
    'simplePos',
    'behindDoc',
    'locked',
    'relativeHeight',
    'allowOverlap',
    'layoutInCell',
  ] as const) {
    expect(schemaAttributeValue(anchor.attributes, name)).toBeDefined();
  }
  expect(anchor.children.some((child) => child.kind === 'drawingSimplePos')).toBe(true);
  expect(anchor.children.some((child) => child.kind === 'drawingPositionH')).toBe(true);
  expect(anchor.children.some((child) => child.kind === 'drawingPositionV')).toBe(true);
  expect(anchor.children.some((child) => child.kind === 'drawingExtent')).toBe(true);
  expect(
    anchor.children.some(
      (child) =>
        child.kind === 'drawingWrapNone' ||
        child.kind === 'drawingWrapSquare' ||
        child.kind === 'drawingWrapTight' ||
        child.kind === 'drawingWrapThrough' ||
        child.kind === 'drawingWrapTopBottom'
    )
  ).toBe(true);
  expect(anchor.children.some((child) => child.kind === 'drawingDocPr')).toBe(true);
  expect(anchor.children.some((child) => child.kind === 'drawingGraphicFramePr')).toBe(true);
  const graphic = anchor.children.find((child) => child.kind === 'drawingGraphic') as
    OoxmlElement | undefined;
  expect(graphic).toBeDefined();
  const graphicData = graphic!.children.find((child) => child.kind === 'drawingGraphicData') as
    OoxmlElement | undefined;
  expect(graphicData).toBeDefined();
  expect(schemaAttributeValue(graphicData!.attributes, 'uri')).toBe(PIC_URI);
  const picture = graphicData!.children.find((child) => child.kind === 'picture') as
    OoxmlElement | undefined;
  if (picture) assertPictureXsdShape(picture);
}

function assertPartPictureDrawings(part: OoxmlPart): void {
  for (const drawing of findAll(part.root, 'drawing')) {
    for (const child of drawing.children) {
      if (child.kind === 'inlineDrawing') assertInlineXsdShape(child);
      if (child.kind === 'anchoredDrawing') assertAnchorXsdShape(child);
    }
  }
}

describe('deterministic fixture XSD shape (Word compatibility)', () => {
  for (const file of GENERATED_PICTURE_FIXTURES) {
    test(`${file}: typed pictures include required pic:cNvPr before pic:cNvPicPr`, () => {
      const pkg = openFixture(file);
      const seenIds = new Set<string>();
      for (const part of pkg.parts.values()) {
        for (const picture of findAll(part.root, 'picture')) {
          assertPictureXsdShape(picture);
          const nvPicPr = picture.children.find((child) => child.kind === 'pictureNvPicPr')!;
          const cNvPr = genericChild(nvPicPr as OoxmlElement, 'cNvPr', PIC);
          const id = schemaAttributeValue(cNvPr.attributes, 'id')!;
          expect(seenIds.has(`${part.name}:${id}`)).toBe(false);
          seenIds.add(`${part.name}:${id}`);
          expect(schemaAttributeValue(cNvPr.attributes, 'name')).toBe('');
        }
      }
    });

    test(`${file}: inline and anchor drawings match ECMA child sequence`, () => {
      const pkg = openFixture(file);
      for (const part of pkg.parts.values()) {
        assertPartPictureDrawings(part);
      }
    });
  }

  test('generated fixtures embed structurally valid PNG/JPEG/GIF media with matching content types', () => {
    for (const file of GENERATED_RASTER_FIXTURES) {
      const pkg = openFixture(file);
      for (const [owner, rels] of pkg.relationships) {
        for (const rel of rels) {
          if (rel.type !== IMAGE_RELATIONSHIP_TYPE || rel.targetMode === 'External') continue;
          const ownerDir = owner.replace(/\/[^/]+$/, '');
          const normalized = rel.rawTarget.startsWith('/')
            ? rel.rawTarget
            : `${ownerDir}/${rel.rawTarget}`;
          const bytes = pkg.partBytes.get(normalized);
          if (!bytes) continue;
          const lower = normalized.toLowerCase();
          if (lower.endsWith('.png')) {
            expect(validateRasterHeader(bytes, 'image/png')).not.toBeNull();
          } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
            expect(validateRasterHeader(bytes, 'image/jpeg')).not.toBeNull();
          } else if (lower.endsWith('.gif')) {
            expect(validateRasterHeader(bytes, 'image/gif')).not.toBeNull();
          }
        }
      }
    }
  });
});
