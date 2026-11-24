import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/index.ts';
import { withHiddenRevisionSites, withoutUnlistedChanges } from '../revision-hidden-sites.ts';
import { revisionAuthorFilter } from '../revision-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const unlisted = (sites: string[], key = '1:2') => ({
  sites: new Set(sites),
  paragraphs: new Map<string, string>(),
  key,
});

const element = (node: unknown): OoxmlElement => {
  if (!node || (node as { kind: string }).kind === 'textValue') throw new Error('not an element');
  return node as OoxmlElement;
};

describe('withHiddenRevisionSites', () => {
  test('hands the base back when nothing is left out', () => {
    const base = revisionAuthorFilter(['Grace']);
    expect(withHiddenRevisionSites(base, unlisted([]))).toBe(base);
  });

  test('keys on the styles and numbering, not on which records are left out', () => {
    const one = withHiddenRevisionSites(undefined, unlisted(['a']));
    const two = withHiddenRevisionSites(undefined, unlisted(['a', 'b']));
    const other = withHiddenRevisionSites(undefined, unlisted(['a'], '3:2'));
    expect(one?.cacheKey).toBe(two?.cacheKey);
    expect(other?.cacheKey).not.toBe(one?.cacheKey);
    // Never the canonical key, so a block cached with records left out is never served as it.
    expect(one?.cacheKey).not.toBe('');
  });

  test('a resolved view also keys on which records each paragraph holds', () => {
    const held = (records: string) => ({
      sites: new Set(['a']),
      paragraphs: new Map([['p', records]]),
      key: '1:2',
    });
    const one = held('a');
    const two = held('a\u0000b');
    expect(withHiddenRevisionSites(undefined, one)?.cacheKey).toBe(
      withHiddenRevisionSites(undefined, two)?.cacheKey
    );
    expect(withHiddenRevisionSites(undefined, one, true)?.cacheKey).not.toBe(
      withHiddenRevisionSites(undefined, two, true)?.cacheKey
    );
  });

  test('strips only the named records of a named paragraph', () => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="left"/><w:pPrChange w:id="1" w:author="Ada"><w:pPr/></w:pPrChange></w:pPr></w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const paragraph = element(element(read.part.root.children[0]).children[0]);
    const change = element(element(paragraph.children[0]).children[1]);
    const filter = withHiddenRevisionSites(undefined, {
      sites: new Set([change.id]),
      paragraphs: new Map([[paragraph.id, change.id]]),
      key: '1:2',
    });
    const stripped = withoutUnlistedChanges(paragraph, filter);
    expect(JSON.stringify(stripped)).not.toContain('pPrChange');
    expect(withoutUnlistedChanges(paragraph, filter)).toBe(stripped);
    expect(withoutUnlistedChanges(paragraph, undefined)).toBe(paragraph);
  });
});
