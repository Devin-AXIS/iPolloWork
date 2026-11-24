import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { blankDocumentBytes } from '../blank-document.ts';

const parts = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return {
    document: strFromU8(files['word/document.xml']!),
    styles: strFromU8(files['word/styles.xml']!),
  };
};

test('a blank document is left to right by default', () => {
  const { document, styles } = parts(blankDocumentBytes());
  expect(document).not.toContain('<w:bidi/>');
  expect(styles).not.toContain('<w:bidi/>');
  expect(styles).not.toContain('w:lang');
});

test('a right-to-left blank document reads right to left in its paragraphs and section', () => {
  const { document, styles } = parts(
    blankDocumentBytes({ direction: 'rtl', bidiLanguage: 'ar-SA' })
  );
  expect(styles).toContain('<w:pPrDefault><w:pPr><w:bidi/><w:spacing');
  expect(styles).toContain('<w:lang w:bidi="ar-SA"/>');
  expect(document).toMatch(/<w:pgMar [^>]*\/><w:bidi\/><\/w:sectPr>/u);
});

test('a value that is not a language tag is not written', () => {
  const { styles } = parts(blankDocumentBytes({ bidiLanguage: 'x"/><w:evil/>' }));
  expect(styles).not.toContain('w:lang');
  expect(styles).not.toContain('evil');
});
