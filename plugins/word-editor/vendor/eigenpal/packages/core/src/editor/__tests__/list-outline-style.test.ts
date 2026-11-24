// A list toggle skips the levels of a heading numbering, and a heading is a paragraph style
// with an outline level. The nearest style in the `basedOn` chain that states one decides.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable } from '../../layout/style-cascade.ts';
import { isOutlineStyle } from '../list-level-geometry.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const style = (id: string, pPr = '', basedOn = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/>` +
  `${basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ''}<w:pPr>${pPr}</w:pPr></w:style>`;

const read = readOoxmlPart(
  `<w:styles xmlns:w="${W}">` +
    style('Heading1', '<w:outlineLvl w:val="0"/>') +
    style('Chapter', '', 'Heading1') +
    style('BodyLike', '<w:outlineLvl w:val="9"/>', 'Heading1') +
    style('ListBullet') +
    '</w:styles>',
  { name: '/word/styles.xml', contentType: 'application/xml' }
);
if (!read.ok) throw new Error(read.reason);
const table = buildStyleCascadeTable(read.part.root);

test('a style with an outline level is a heading, and so is one based on it', () => {
  expect(isOutlineStyle(table, 'Heading1')).toBe(true);
  expect(isOutlineStyle(table, 'Chapter')).toBe(true);
});

test('a nearer body-text level wins over the heading it is based on', () => {
  expect(isOutlineStyle(table, 'BodyLike')).toBe(false);
});

test('a template list style with no outline level is no heading', () => {
  expect(isOutlineStyle(table, 'ListBullet')).toBe(false);
  expect(isOutlineStyle(undefined, 'Heading1')).toBe(false);
});
