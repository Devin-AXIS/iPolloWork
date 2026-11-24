// Adversarial tests for runtime-sink sanitization + inert executable content
// (document-engine task 2.8). All functions are pure string transforms — no
// external request is possible.

import { describe, expect, test } from 'bun:test';
import {
  sanitizeHref,
  escapeXml,
  escapeCssString,
  containsCssFetch,
  isInertExecutable,
  isEvaluableField,
  scrubExport,
  INERT_EXECUTABLE_KINDS,
} from '../package/sinks.ts';

describe('sanitizeHref', () => {
  test('allows the scheme allowlist and relative URLs', () => {
    for (const ok of [
      'https://x.com/a',
      'http://x',
      'mailto:a@b.com',
      'tel:+15551234',
      'ftp://h/f',
      '/rel/path',
      'page.html',
    ]) {
      expect(sanitizeHref(ok).ok).toBe(true);
    }
  });
  test('renders dangerous schemes inert, including tab/newline-smuggled ones', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<x>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      'JaVaScRiPt:x',
    ]) {
      expect(sanitizeHref(bad)).toEqual({ ok: false, inert: true });
    }
    // Embedded control chars must not let "java\nscript:" through.
    expect(sanitizeHref('java\nscript:alert(1)')).toEqual({ ok: false, inert: true });
    expect(sanitizeHref('  java\tscript:alert(1)')).toEqual({ ok: false, inert: true });
  });
});

describe('string escaping', () => {
  test('escapeXml neutralizes markup metacharacters', () => {
    expect(escapeXml(`<a href="x" & 'y'>`)).toBe(
      '&lt;a href=&quot;x&quot; &amp; &apos;y&apos;&gt;'
    );
  });
  test('escapeCssString prevents string breakout', () => {
    const out = escapeCssString('Arial"; } body { background: url(evil)');
    expect(out).not.toContain('"');
    // The escaped form no longer contains a raw closing-quote breakout.
    expect(/(^|[^\\])"/.test(out)).toBe(false);
  });
  test('containsCssFetch flags url() and @import', () => {
    expect(containsCssFetch('background: url(http://x)')).toBe(true);
    expect(containsCssFetch('@import "x.css"')).toBe(true);
    expect(containsCssFetch('color: red')).toBe(false);
  });
});

describe('inert executable content', () => {
  test('executable classes are inert; page fields are evaluable', () => {
    for (const k of INERT_EXECUTABLE_KINDS) expect(isInertExecutable(k)).toBe(true);
    expect(isInertExecutable('paragraph')).toBe(false);
    expect(isEvaluableField('PAGE')).toBe(true);
    expect(isEvaluableField('NUMPAGES \\* MERGEFORMAT')).toBe(true);
    // Fetch/execute field codes are NOT evaluable.
    expect(isEvaluableField('INCLUDETEXT "http://x"')).toBe(false);
    expect(isEvaluableField('DDEAUTO Excel Sheet1 R1C1')).toBe(false);
    expect(isEvaluableField('MACROBUTTON Evil')).toBe(false);
  });
  test('scrubExport removes inert executables and declares non-lossless', () => {
    const r = scrubExport([
      { id: 'p1', kind: 'paragraph' },
      { id: 'm1', kind: 'macro' },
      { id: 'o1', kind: 'ole' },
    ]);
    expect(r.kept.map((k) => k.id)).toEqual(['p1']);
    expect(r.removed.map((k) => k.id)).toEqual(['m1', 'o1']);
    expect(r.nonLossless).toBe(true);
  });
  test('scrub with nothing to remove is lossless', () => {
    expect(scrubExport([{ id: 'p1', kind: 'paragraph' }]).nonLossless).toBe(false);
  });
});
