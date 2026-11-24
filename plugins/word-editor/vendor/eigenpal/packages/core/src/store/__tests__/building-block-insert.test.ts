// Building block galleries: the glossary reader lists a control's blocks, and
// `insertBuildingBlock` lands one block's body inside the control with fresh identities.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage, readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../index.ts';
import {
  buildingBlockGalleryOf,
  buildingBlocksForControl,
  buildingBlocksOf,
} from '../package/building-blocks.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { validateTreeOp } from '../store/tree-op-validate.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { zipDoc } from './canonical-primitive-journal-coverage-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const GLOSSARY_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument';
const GLOSSARY_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml';

function docPart(name: string, gallery: string, category: string, body: string): string {
  return (
    `<w:docPart><w:docPartPr><w:name w:val="${name}"/><w:category><w:name w:val="${category}"/>` +
    `<w:gallery w:val="${gallery}"/></w:category></w:docPartPr><w:docPartBody>${body}</w:docPartBody></w:docPart>`
  );
}

const GLOSSARY =
  `<w:glossaryDocument xmlns:w="${W}" xmlns:w14="${W14}"><w:docParts>` +
  docPart(
    'DefaultPlaceholder_1',
    'placeholder',
    'General',
    '<w:p><w:r><w:t>Choose a building block.</w:t></w:r></w:p>'
  ) +
  docPart(
    'Sign-off',
    'docParts',
    'General',
    '<w:p w14:paraId="1A2B3C4D"><w:r><w:t>Approved by</w:t></w:r></w:p>' +
      '<w:p w14:paraId="1A2B3C4E"><w:r><w:t>Date</w:t></w:r></w:p><w:sectPr/>'
  ) +
  docPart('Address', 'docParts', 'General', '<w:p><w:r><w:t>1 Main St</w:t></w:r></w:p>') +
  docPart('Legal', 'docParts', 'Contracts', '<w:p><w:r><w:t>Clause</w:t></w:r></w:p>') +
  docPart('Cover', 'coverPg', 'General', '<w:p><w:r><w:t>Title</w:t></w:r></w:p>') +
  docPart('', 'docParts', 'General', '<w:p><w:r><w:t>Unnamed</w:t></w:r></w:p>') +
  '</w:docParts></w:glossaryDocument>';

function gallerySdt(pr: string, content: string): string {
  return (
    `<w:sdt><w:sdtPr><w:id w:val="7"/><w:showingPlcHdr/><w:docPartList>${pr}</w:docPartList></w:sdtPr>` +
    `<w:sdtContent>${content}</w:sdtContent></w:sdt>`
  );
}

function packageOf(body: string) {
  const bytes = zipDoc({
    body,
    rels: `<Relationship Id="rId9" Type="${GLOSSARY_TYPE}" Target="glossary/document.xml"/>`,
    overrides: `<Override PartName="/word/glossary/document.xml" ContentType="${GLOSSARY_CONTENT_TYPE}"/>`,
    extraXml: { 'word/glossary/document.xml': GLOSSARY },
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function findKind(node: OoxmlNode, kind: string): OoxmlNode {
  const found = (candidate: OoxmlNode): OoxmlNode | undefined => {
    if (candidate.kind === kind) return candidate;
    if (candidate.kind === 'textValue') return undefined;
    for (const child of candidate.children) {
      const hit = found(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const hit = found(node);
  if (!hit) throw new Error(`missing ${kind}`);
  return hit;
}

function payloadBlocks(xml: string): readonly OoxmlNode[] {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${xml}</w:body></w:document>`,
    { name: '/word/payload.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = findKind(parsed.part.root, 'body');
  return body.kind === 'textValue' ? [] : body.children;
}

function partOf(body: string): OoxmlPart {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

const INLINE_GALLERY =
  '<w:p><w:r><w:t xml:space="preserve">Pick: </w:t></w:r>' +
  gallerySdt(
    '<w:docPartCategory w:val="General"/><w:docPartGallery w:val="Quick Parts"/>',
    '<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Choose a building block.</w:t></w:r>'
  ) +
  '</w:p>';

const BLOCK_GALLERY =
  gallerySdt(
    '<w:docPartGallery w:val="docParts"/>',
    '<w:p><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Choose a building block.</w:t></w:r></w:p>'
  ) + '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

describe('glossary building blocks', () => {
  test('lists every named block with its gallery and category, minus section marks', () => {
    const blocks = buildingBlocksOf(packageOf(INLINE_GALLERY));
    expect(blocks.map((block) => [block.name, block.gallery, block.category])).toEqual([
      ['DefaultPlaceholder_1', 'placeholder', 'General'],
      ['Sign-off', 'docParts', 'General'],
      ['Address', 'docParts', 'General'],
      ['Legal', 'docParts', 'Contracts'],
      ['Cover', 'coverPg', 'General'],
    ]);
    expect(blocks[1]!.blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph']);
  });

  test('a control names its gallery by display name and lists that gallery and category', () => {
    const pkg = packageOf(INLINE_GALLERY);
    const control = findKind(pkg.parts.get(pkg.mainDocumentPart)!.root, 'contentControl');
    expect(buildingBlockGalleryOf(control)).toEqual({
      gallery: 'Quick Parts',
      category: 'General',
    });
    // Placeholders sit in their own gallery; another gallery and another category stay out.
    expect(buildingBlocksForControl(pkg, control).map((block) => block.name)).toEqual([
      'Address',
      'Sign-off',
    ]);
  });

  test('a control without a category lists every category of its gallery, grouped', () => {
    const pkg = packageOf(BLOCK_GALLERY);
    const control = findKind(pkg.parts.get(pkg.mainDocumentPart)!.root, 'contentControl');
    expect(buildingBlocksForControl(pkg, control).map((block) => block.name)).toEqual([
      'Legal',
      'Address',
      'Sign-off',
    ]);
  });

  test('a document without a glossary offers nothing', () => {
    const bytes = zipDoc({ body: INLINE_GALLERY });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const control = findKind(
      loaded.package.parts.get(loaded.package.mainDocumentPart)!.root,
      'contentControl'
    );
    expect(buildingBlocksForControl(loaded.package, control)).toEqual([]);
    expect(
      buildingBlockGalleryOf(
        findKind(loaded.package.parts.get(loaded.package.mainDocumentPart)!.root, 'paragraph')
      )
    ).toBeNull();
  });
});

describe('insertBuildingBlock', () => {
  test('an inline control takes the runs of a one-paragraph block and drops its prompt', () => {
    const part = partOf(INLINE_GALLERY);
    const controlId = findKind(part.root, 'contentControl').id;
    const op = {
      op: 'insertBuildingBlock' as const,
      controlId,
      name: 'Address',
      blocks: payloadBlocks(
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>1 Main St</w:t></w:r></w:p>'
      ),
    };
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    if (!result.ok) throw new Error(result.reason);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('<w:t>1 Main St</w:t>');
    expect(xml).not.toContain('Choose a building block.');
    expect(xml).not.toContain('showingPlcHdr');
    // The paragraph's own properties stay behind: runs join the host paragraph.
    expect(xml).not.toContain('<w:jc');
    expect(xml).toContain('Pick: ');
  });

  test('a block control takes the whole body with fresh paragraph identities', () => {
    const part = partOf(BLOCK_GALLERY);
    const controlId = findKind(part.root, 'contentControl').id;
    const op = {
      op: 'insertBuildingBlock' as const,
      controlId,
      name: 'Sign-off',
      blocks: payloadBlocks(
        '<w:p w14:paraId="1A2B3C4D"><w:r><w:t>Approved by</w:t></w:r></w:p>' +
          '<w:p w14:paraId="1A2B3C4E"><w:r><w:t>Date</w:t></w:r></w:p>'
      ),
    };
    expect(validateTreeOp(part, op)).toBeNull();
    const result = applyTreeOp(part, op);
    if (!result.ok) throw new Error(result.reason);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('<w:t>Approved by</w:t>');
    expect(xml).toContain('<w:t>Date</w:t>');
    expect(xml).not.toContain('1A2B3C4D');
    expect(xml).not.toContain('Choose a building block.');
    // A second pick of the same block never reuses the ids of the first.
    const again = applyTreeOp(result.part, op);
    if (!again.ok) throw new Error(again.reason);
    const ids = new Set<string>();
    const walk = (node: OoxmlNode): void => {
      expect(ids.has(node.id)).toBe(false);
      ids.add(node.id);
      if (node.kind !== 'textValue') node.children.forEach(walk);
    };
    walk(again.part.root);
  });

  test('refuses a many-paragraph body for an inline control instead of flattening it', () => {
    const part = partOf(INLINE_GALLERY);
    const controlId = findKind(part.root, 'contentControl').id;
    expect(
      validateTreeOp(part, {
        op: 'insertBuildingBlock',
        controlId,
        name: 'Sign-off',
        blocks: payloadBlocks(
          '<w:p><w:r><w:t>Approved by</w:t></w:r></w:p><w:p><w:r><w:t>Date</w:t></w:r></w:p>'
        ),
      })
    ).toBe('unsupported');
  });

  test('refuses a control that is not a gallery, a locked gallery, and an empty body', () => {
    const plain = partOf(
      '<w:p><w:sdt><w:sdtPr><w:id w:val="1"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const blocks = payloadBlocks('<w:p><w:r><w:t>1 Main St</w:t></w:r></w:p>');
    expect(
      validateTreeOp(plain, {
        op: 'insertBuildingBlock',
        controlId: findKind(plain.root, 'contentControl').id,
        name: 'Address',
        blocks,
      })
    ).toBe('typeMismatch');
    const locked = partOf(
      '<w:p>' +
        gallerySdt(
          '<w:docPartGallery w:val="Quick Parts"/>',
          '<w:r><w:t>Choose a building block.</w:t></w:r>'
        ).replace('</w:docPartList>', '</w:docPartList><w:lock w:val="contentLocked"/>') +
        '</w:p>'
    );
    expect(
      validateTreeOp(locked, {
        op: 'insertBuildingBlock',
        controlId: findKind(locked.root, 'contentControl').id,
        name: 'Address',
        blocks,
      })
    ).toBe('locked');
    const open = partOf(INLINE_GALLERY);
    expect(
      validateTreeOp(open, {
        op: 'insertBuildingBlock',
        controlId: findKind(open.root, 'contentControl').id,
        name: 'Address',
        blocks: [],
      })
    ).toBe('fragment-invalid-block');
    expect(
      validateTreeOp(open, {
        op: 'insertBuildingBlock',
        controlId: 'missing',
        name: 'Address',
        blocks,
      })
    ).toBe('unknown-control');
  });
});
