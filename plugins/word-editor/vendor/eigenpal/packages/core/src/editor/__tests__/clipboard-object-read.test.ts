import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { createSurfaceClipboardOps, type SurfaceClipboardDeps } from '../surface-clipboard-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const object =
  '<w:object xmlns:v="urn:schemas-microsoft-com:vml"><v:shape type="#_x0000_t75" style="width:10pt;height:12pt"><v:imagedata xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="preview"/></v:shape></w:object>';

function part(name: string, root: string, content: string) {
  const paragraph = `<w:p><w:r>${content}</w:r></w:p>`;
  const inner = root === 'document' ? `<w:body>${paragraph}</w:body>` : paragraph;
  const parsed = readOoxmlPart(`<w:${root} xmlns:w="${W}">${inner}</w:${root}>`, {
    name,
    contentType: `application/vnd.openxmlformats-officedocument.wordprocessingml.${root === 'document' ? 'document.main' : 'header'}+xml`,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function paragraphId(node: OoxmlNode): string {
  if (node.kind === 'paragraph') return node.id;
  if (node.kind !== 'textValue') {
    for (const child of node.children) {
      const id = paragraphId(child);
      if (id) return id;
    }
  }
  return '';
}

for (const selectedObject of [true, false]) {
  test(`header clipboard preflight reads its own part without opening a store: object=${selectedObject}`, () => {
    const header = part('/word/header1.xml', 'hdr', selectedObject ? object : '<w:t>Safe</w:t>');
    const body = part(
      '/word/document.xml',
      'document',
      selectedObject ? '<w:t>Safe</w:t>' : object
    );
    const id = paragraphId(header.root);
    let opened = 0;
    const results: unknown[] = [];
    const deps = {
      session: {
        part: () => body,
        currentPackage: () => ({
          parts: new Map([
            [body.name, body],
            [header.name, header],
          ]),
        }),
        partFor: () => {
          opened++;
          return header;
        },
      },
      flushPendingInputAndLayout() {},
      cellSelection: () => null,
      orderedRange: () => ({
        from: { paragraphId: id, offset: 0 },
        to: { paragraphId: id, offset: 1 },
      }),
      paragraphOrder: () => [id],
      storyScope: () => ({ kind: 'headerFooter', rId: 'header' }),
      layout: () => ({ pages: [] }),
      commit: (run: () => unknown) => {
        results.push(run());
      },
    } as unknown as SurfaceClipboardDeps;
    const result = createSurfaceClipboardOps(deps).copyFlavoursNow();
    expect(opened).toBe(0);
    expect(result).toEqual(
      selectedObject
        ? { text: '', html: null, reason: 'unsupported-content' }
        : { text: '', html: null }
    );
    expect(results).toHaveLength(selectedObject ? 1 : 0);
  });
}
