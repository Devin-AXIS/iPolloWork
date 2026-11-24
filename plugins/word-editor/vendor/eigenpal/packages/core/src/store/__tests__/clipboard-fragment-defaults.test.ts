// Omitted default formatting travels with a copy as the application's values the source painted.
// Content without a styles part of its own, such as external HTML, carries no defaults.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart } from '../package/ooxml-tree.ts';
import { extractFragmentPackage } from '../store/clipboard-fragment-extract.ts';
import {
  CT,
  R,
  REL,
  W,
  bodyOf,
  buildPackage,
  fullBodyCoverage,
  openStore,
  paragraphIdsUnder,
} from './clipboard-fragment-fixtures.ts';

describe('omitted defaults travel as what the source painted', () => {
  const styles = (inner: string) => `<w:styles xmlns:w="${W}">${inner}</w:styles>`;
  const authoredTenPoint = styles(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault/></w:docDefaults>'
  );
  const pasteInto = (targetStyles: string | null, fragmentBytes: Uint8Array): string => {
    const store = openStore(
      targetStyles === null
        ? buildPackage('<w:p/>')
        : buildPackage('<w:p/>', { 'word/styles.xml': targetStyles })
    );
    const main = store.currentPackage().mainDocumentPart;
    const hostId = paragraphIdsUnder(bodyOf(store.currentPackage().parts.get(main)!))[0]!;
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 0, fragmentBytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(true);
    return serializeOoxmlPart(store.currentPackage().parts.get(main)!);
  };
  const copied = (source: OoxmlPackage): Uint8Array => {
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    if (!extracted.ok) throw new Error('extract failed');
    return extracted.bytes;
  };
  const plain = '<w:p><w:r><w:t>carried</w:t></w:r></w:p>';

  test('a source that omits its defaults pastes its 12pt and 8pt after', () => {
    for (const source of [
      buildPackage(plain),
      buildPackage(plain, {
        'word/styles.xml': styles('<w:style w:type="paragraph" w:styleId="Body"/>'),
      }),
    ]) {
      const xml = pasteInto(authoredTenPoint, copied(source));
      expect(xml).toContain('<w:sz w:val="24"/>');
      expect(xml).toContain('w:after="160"');
    }
  });

  test('partial spacing on a style or the paragraph gains only the attributes it leaves out', () => {
    const headStyles = styles(
      '<w:style w:type="paragraph" w:styleId="Head"><w:pPr><w:spacing w:before="240"/></w:pPr></w:style>'
    );
    for (const pPr of [
      '<w:pPr><w:pStyle w:val="Head"/></w:pPr>',
      '<w:pPr><w:spacing w:before="240"/></w:pPr>',
    ]) {
      const source = buildPackage(`<w:p>${pPr}<w:r><w:t>carried</w:t></w:r></w:p>`, {
        'word/styles.xml': headStyles,
      });
      const xml = pasteInto(authoredTenPoint, copied(source));
      const spacing = xml.match(/<w:spacing [^>]*\/>/g) ?? [];
      expect(spacing).toHaveLength(1);
      expect(spacing[0]).toContain('w:after="160"');
      expect(spacing[0]).toContain('w:line="278"');
      // The style states w:before itself; only direct spacing keeps it on the paragraph.
      expect(spacing[0]!.includes('w:before="240"')).toBe(pPr.includes('w:spacing'));
    }
  });

  test('external content without a styles part stamps nothing', () => {
    const external = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${plain}</w:body></w:document>`
      ),
    });
    const xml = pasteInto(authoredTenPoint, external);
    expect(xml).not.toContain('<w:sz');
    expect(xml).not.toContain('<w:spacing');
  });
});
