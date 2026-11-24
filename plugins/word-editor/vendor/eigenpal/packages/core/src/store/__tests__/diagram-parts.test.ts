// SmartArt package part resolution: data model and saved drawing parts, through the story
// part's relationships, with the bounded trust rules for types, targets and roots.

import { describe, expect, test } from 'bun:test';
import { createDiagramPartResolver } from '../package/diagram-parts.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import { DSP, smartArtPackage, type SmartArtDocxOptions } from './smartart-fixture.ts';

const DOCUMENT = '/word/document.xml';

function findRelIds(pkg: OoxmlPackage): OoxmlElement {
  const stack: OoxmlNode[] = [pkg.parts.get(DOCUMENT)!.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.localName === 'relIds') return node;
    stack.push(...node.children);
  }
  throw new Error('no dgm:relIds');
}

function resolve(options: SmartArtDocxOptions) {
  const pkg = smartArtPackage(options);
  return createDiagramPartResolver(pkg, DOCUMENT)(findRelIds(pkg));
}

const SHAPE = { off: [0, 0], ext: [100, 100] } as const;

describe('diagram part resolution', () => {
  test('finds the data model and the saved drawing through the story part', () => {
    const parts = resolve({ shapes: [SHAPE] });
    expect(parts?.dataModel.localName).toBe('dataModel');
    expect(parts?.drawing?.namespaceUri).toBe(DSP);
    expect(parts?.drawing?.localName).toBe('drawing');
    expect(parts?.drawingPartName).toBe('/word/diagrams/drawing1.xml');
  });

  test('falls back to a drawing relationship written on the data part', () => {
    const parts = resolve({ shapes: [SHAPE], drawingRelationship: 'data' });
    expect(parts?.drawingPartName).toBe('/word/diagrams/drawing1.xml');
  });

  test('a data model without the drawing pointer resolves with no drawing', () => {
    const parts = resolve({ shapes: [SHAPE], omitDataModelExt: true });
    expect(parts?.dataModel.localName).toBe('dataModel');
    expect(parts?.drawing).toBeNull();
    expect(parts?.drawingPartName).toBeNull();
  });

  test('a missing drawing relationship or part resolves with no drawing', () => {
    expect(resolve({ drawingRelationship: 'none' })?.drawing).toBeNull();
    expect(resolve({ drawingRelationship: 'dangling' })?.drawing).toBeNull();
  });

  test('refuses relationships of the wrong type', () => {
    expect(resolve({ dataRelationshipType: 'urn:test/other' })).toBeNull();
    expect(
      resolve({ shapes: [SHAPE], drawingRelationshipType: 'urn:test/other' })?.drawing
    ).toBeNull();
  });

  test('never resolves an external drawing target', () => {
    expect(resolve({ shapes: [SHAPE], drawingExternal: true })?.drawing).toBeNull();
  });

  test('refuses parts whose roots are not the expected elements', () => {
    expect(resolve({ dataPartXml: `<dsp:drawing xmlns:dsp="${DSP}"/>` })).toBeNull();
    expect(
      resolve({
        drawingPartXml:
          '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>',
      })?.drawing
    ).toBeNull();
  });

  test('refuses relIds without a data model id', () => {
    expect(resolve({ omitDataId: true })).toBeNull();
  });

  test('refuses an element that is not dgm:relIds', () => {
    const pkg = smartArtPackage({ shapes: [SHAPE] });
    const resolver = createDiagramPartResolver(pkg, DOCUMENT);
    expect(resolver(pkg.parts.get(DOCUMENT)!.root)).toBeNull();
  });

  test('caches one resolver per package and owner, and one result per relIds element', () => {
    const pkg = smartArtPackage({ shapes: [SHAPE] });
    const resolver = createDiagramPartResolver(pkg, DOCUMENT);
    expect(createDiagramPartResolver(pkg, DOCUMENT)).toBe(resolver);
    const relIds = findRelIds(pkg);
    expect(resolver(relIds)).toBe(resolver(relIds));
  });
});
