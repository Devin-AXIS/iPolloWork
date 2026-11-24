import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, serializeOoxmlPart } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

for (const name of ['ins', 'del', 'moveFrom', 'moveTo']) {
  for (const action of ['accept', 'reject'] as const) {
    for (const all of [false, true]) {
      test(`${action}${all ? ' all' : ''} refuses generic ${name} without content loss`, () => {
        const source = `<w:document xmlns:w="${W}"><w:body>
          <w:p><w:r><w:t>Unchanged</w:t></w:r>
            <w:ins w:id="1" w:author="QA"><w:r><w:t>Valid insertion</w:t></w:r></w:ins>
          </w:p>
          <w:${name} w:id="2" w:author="QA">
            <w:p><w:r><w:t>Preserved unsupported content</w:t></w:r></w:p>
          </w:${name}>
        </w:body></w:document>`;
        const parsed = readOoxmlPart(source, {
          name: '/word/document.xml',
          contentType: 'app/xml',
        });
        if (!parsed.ok) throw new Error(parsed.reason);
        const before = serializeOoxmlPart(parsed.part);
        const result = applyTreeOp(
          parsed.part,
          all
            ? { op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' }
            : {
                op: action === 'accept' ? 'acceptRevision' : 'rejectRevision',
                revision: { id: '2', author: 'QA' },
              }
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('unsupported-revision');
        expect(serializeOoxmlPart(parsed.part)).toBe(before);
        expect(before).toContain('Preserved unsupported content');
        const reopened = readOoxmlPart(before, {
          name: '/word/document.xml',
          contentType: 'app/xml',
        });
        expect(reopened.ok).toBe(true);
        if (reopened.ok) expect(serializeOoxmlPart(reopened.part)).toBe(before);
      });
    }
  }
}

for (const name of ['ins', 'del', 'moveFrom', 'moveTo']) {
  for (const action of ['accept', 'reject'] as const) {
    for (const child of [
      '<w:r><w:t>Protected</w:t></w:r>',
      '<w:p><w:r><w:t>Protected</w:t></w:r></w:p>',
    ]) {
      test(`${action}: ${name} paragraph marker refuses nonempty children ${child}`, () => {
        const parsed = readOoxmlPart(
          `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:rPr><w:${name} w:id="1" w:author="QA">${child}</w:${name}></w:rPr></w:pPr><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`,
          { name: '/word/document.xml', contentType: 'app/xml' }
        );
        if (!parsed.ok) throw new Error(parsed.reason);
        const before = serializeOoxmlPart(parsed.part);
        const result = applyTreeOp(parsed.part, {
          op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('unsupported-revision');
        expect(serializeOoxmlPart(parsed.part)).toBe(before);
      });
    }
  }
}
for (const name of ['ins', 'del']) {
  for (const action of ['accept', 'reject'] as const) {
    for (const location of ['row', 'numbering']) {
      test(`${action}: nonempty ${location} ${name} refuses`, () => {
        const marker = `<w:${name} w:id="1" w:author="QA"><w:r><w:t>Protected</w:t></w:r></w:${name}>`;
        const content =
          location === 'row'
            ? `<w:tbl><w:tr><w:trPr>${marker}</w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>`
            : `<w:p><w:pPr><w:numPr><w:numId w:val="1"/>${marker}</w:numPr></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>`;
        const parsed = readOoxmlPart(
          `<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`,
          { name: '/word/document.xml', contentType: 'app/xml' }
        );
        if (!parsed.ok) throw new Error(parsed.reason);
        const before = serializeOoxmlPart(parsed.part);
        const result = applyTreeOp(parsed.part, {
          op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('unsupported-revision');
        expect(serializeOoxmlPart(parsed.part)).toBe(before);
      });
    }
  }
}
