import { describe, expect, it } from 'bun:test';
import { resolveEndnoteProperties, resolveFootnoteProperties } from '../note-properties';

describe('a section note number format', () => {
  it('is the default when the section authors note properties without a format, whatever the document says', () => {
    const resolved = resolveFootnoteProperties(
      { numRestart: 'eachSect' },
      { numFmt: 'chicago', numRestart: 'eachSect' }
    );
    expect(resolved.numFmt).toBe('decimal');
    expect(resolved.numRestart).toBe('eachSect');
  });

  it('is the section format when the section names one', () => {
    expect(resolveFootnoteProperties({ numFmt: 'chicago' }, { numFmt: 'decimal' }).numFmt).toBe(
      'chicago'
    );
  });

  it('keeps the endnote default for a section that authors endnote properties without a format', () => {
    expect(resolveEndnoteProperties({ numRestart: 'eachSect' }, { numFmt: 'decimal' }).numFmt).toBe(
      'lowerRoman'
    );
  });
});

describe('document-wide note properties in settings.xml', () => {
  it('do not number or place the footnotes of a section with none of its own', () => {
    expect(
      resolveFootnoteProperties(undefined, {
        numFmt: 'chicago',
        numStart: 3,
        numRestart: 'eachSect',
        pos: 'beneathText',
      })
    ).toEqual({ pos: 'pageBottom', numFmt: 'decimal', numStart: 1, numRestart: 'continuous' });
  });

  it('do not fill the footnote fields a section leaves out', () => {
    expect(
      resolveFootnoteProperties(
        { numStart: 3 },
        { numFmt: 'upperLetter', numRestart: 'eachSect', pos: 'beneathText' }
      )
    ).toEqual({ pos: 'pageBottom', numFmt: 'decimal', numStart: 3, numRestart: 'continuous' });
  });

  it('do not number endnotes, but place them', () => {
    expect(
      resolveEndnoteProperties(undefined, {
        numFmt: 'upperLetter',
        numStart: 4,
        numRestart: 'eachSect',
        pos: 'sectEnd',
      })
    ).toEqual({ pos: 'sectEnd', numFmt: 'lowerRoman', numStart: 1, numRestart: 'continuous' });
  });

  it('alone place endnotes: a section endnote position does not apply', () => {
    expect(resolveEndnoteProperties({ pos: 'docEnd' }, { pos: 'sectEnd' }).pos).toBe('sectEnd');
    expect(resolveEndnoteProperties({ pos: 'sectEnd' }, undefined).pos).toBe('docEnd');
    expect(resolveEndnoteProperties(undefined, { pos: 'pageBottom' }).pos).toBe('docEnd');
  });

  it('keep a section footnote position', () => {
    expect(resolveFootnoteProperties({ pos: 'beneathText' }, { pos: 'pageBottom' }).pos).toBe(
      'beneathText'
    );
  });
});
