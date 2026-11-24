// Text typed right after the last character of a fitted group (`w:fitText`) starts a run
// without the property; text typed inside the group joins it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FIT = '<w:fitText w:val="2880" w:id="7"/>';

const run = (text: string, props = '') =>
  `<w:r><w:rPr><w:b/>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

function docx(paragraph: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p>${paragraph}</w:p></w:body></w:document>`
    ),
  });
}

/** Each saved run's text with whether it carries `w:fitText`. */
function savedRuns(surface: PaginatedSurface): string[] {
  const xml = strFromU8(unzipSync(surface.session.save())['word/document.xml']!);
  const runs = [...xml.matchAll(/<w:r[ >].*?<\/w:r>/gs)].map((match) => {
    const text = [...match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('');
    return `${text}${match[0].includes('w:fitText') ? ' (fit)' : ''}`;
  });
  return xml.includes('<w:ins ') ? [...runs, '<ins>'] : runs;
}

/** Whether the saved paragraph holds a tracked insertion. */
function insertionTracked(runs: string[]): boolean {
  return runs.includes('<ins>');
}

function withTyping(paragraph: string, offset: number, text: string, mode?: 'suggest'): string[] {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(paragraph), { author: 'Ada' });
  if (!opened.ok) throw new Error(opened.reason);
  const surface = opened.surface;
  try {
    if (mode) surface.setEditingMode(mode);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
    surface.type(text);
    return savedRuns(surface);
  } finally {
    surface.destroy();
    container.remove();
  }
}

describe('typing at a fitted group', () => {
  test('text typed right after the group starts a run without w:fitText', () => {
    const runs = withTyping(run('[') + run('ABCDE', FIT) + run(']'), 6, 'Z');
    expect(runs.join('|')).toBe('[|ABCDE (fit)|Z|]');
  });

  test('at the paragraph end the typed text also stays out of the group', () => {
    const runs = withTyping(run('[') + run('ABCDE', FIT), 6, 'Z');
    expect(runs.join('|')).toBe('[|ABCDE (fit)|Z');
  });

  test('in suggesting mode the text typed after the group stays out of it too', () => {
    const runs = withTyping(run('[') + run('ABCDE', FIT) + run(']'), 6, 'Z', 'suggest');
    expect(insertionTracked(runs)).toBe(true);
    expect(runs.filter((text) => text !== '<ins>').join('|')).toBe('[|ABCDE (fit)|Z|]');
  });

  test('text typed inside the group joins it', () => {
    const runs = withTyping(run('[') + run('ABCDE', FIT) + run(']'), 3, 'xy');
    expect(runs.join('|')).toBe('[|ABxyCDE (fit)|]');
  });

  test('between two runs of one group the text joins the group', () => {
    const runs = withTyping(run('[') + run('ABC', FIT) + run('DE', FIT) + run(']'), 4, 'z');
    expect(runs.filter((text) => text.includes('z'))).toEqual(['ABCz (fit)']);
  });
});
