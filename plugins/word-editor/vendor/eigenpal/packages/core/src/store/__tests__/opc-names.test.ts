// Adversarial tests for the OPC/ZIP/relationship normalization profile
// (document-engine task 2.2). Covers the trust-boundary rejections, the
// "two entries normalize to one name" scenario, owner-relative resolution
// without root escape, and the external-URI profile.

import { describe, expect, test } from 'bun:test';
import {
  normalizePartName,
  detectDuplicateNames,
  resolveInternalTarget,
  validateExternalTarget,
  partNameKey,
  type NameRejection,
} from '../package/opc-names.ts';

function reason(r: ReturnType<typeof normalizePartName>): NameRejection | 'ok' {
  return r.ok ? 'ok' : r.reason;
}

describe('normalizePartName', () => {
  test('canonicalizes with and without leading slash', () => {
    expect(normalizePartName('word/document.xml')).toEqual({
      ok: true,
      partName: '/word/document.xml',
    });
    expect(normalizePartName('/word/document.xml')).toEqual({
      ok: true,
      partName: '/word/document.xml',
    });
  });
  test('rejects the traversal/encoding/drive attack surface', () => {
    expect(reason(normalizePartName('word\\styles.xml'))).toBe('backslash');
    expect(reason(normalizePartName('C:/word/x.xml'))).toBe('drive-or-unc');
    expect(reason(normalizePartName('//server/share/x'))).toBe('drive-or-unc');
    expect(reason(normalizePartName('word%2f..%2fsecret'))).toBe('encoded-separator');
    expect(reason(normalizePartName('%2e%2e/secret'))).toBe('encoded-dot');
    expect(reason(normalizePartName('word/../secret.xml'))).toBe('dot-segment');
    expect(reason(normalizePartName('word/./x.xml'))).toBe('dot-segment');
    expect(reason(normalizePartName('word//x.xml'))).toBe('empty-segment');
    expect(reason(normalizePartName('word/foo./x.xml'))).toBe('segment-trailing-dot');
    expect(reason(normalizePartName('%zz'))).toBe('bad-encoding');
    expect(reason(normalizePartName(''))).toBe('empty');
  });
  test('rejects a control character (including one hidden by percent-encoding)', () => {
    expect(reason(normalizePartName('word/\x00.xml'))).toBe('control-char');
    expect(reason(normalizePartName('word/%00.xml'))).toBe('control-char');
  });
  test('decodes safe percent-encoding canonically', () => {
    // %41 == "A" is a safe (non-separator, non-dot) encoding.
    expect(normalizePartName('word/%41.xml')).toEqual({ ok: true, partName: '/word/A.xml' });
  });
});

describe('duplicate detection before inflation', () => {
  test('two names colliding after case-folded normalization are flagged', () => {
    const { duplicates } = detectDuplicateNames(['word/x.xml', 'Word/X.xml']);
    expect(duplicates).toContain(partNameKey('/word/x.xml'));
  });
  test('rejected names are reported, not silently dropped', () => {
    const { rejected } = detectDuplicateNames(['ok/a.xml', 'bad\\b.xml']);
    expect(rejected.map((r) => r.reason)).toContain('backslash');
  });
});

describe('resolveInternalTarget (owner-relative, no root escape)', () => {
  const owner = '/word/document.xml';
  test('resolves relative media and parent references within root', () => {
    expect(resolveInternalTarget(owner, 'media/image1.png')).toEqual({
      ok: true,
      partName: '/word/media/image1.png',
    });
    expect(resolveInternalTarget(owner, '../customXml/item1.xml')).toEqual({
      ok: true,
      partName: '/customXml/item1.xml',
    });
    expect(resolveInternalTarget(owner, './styles.xml')).toEqual({
      ok: true,
      partName: '/word/styles.xml',
    });
  });
  test('package-absolute target resolves from root', () => {
    expect(resolveInternalTarget(owner, '/word/numbering.xml')).toEqual({
      ok: true,
      partName: '/word/numbering.xml',
    });
  });
  test('escaping the package root is rejected', () => {
    expect(reason(resolveInternalTarget(owner, '../../../../etc/passwd'))).toBe('traversal-escape');
    expect(reason(resolveInternalTarget(owner, '..%2f..%2fx'))).toBe('encoded-separator');
  });
});

describe('validateExternalTarget (absolute-URI profile, no fetch)', () => {
  test('accepts absolute http/mailto and preserves raw', () => {
    expect(validateExternalTarget('https://example.com/a')).toEqual({
      ok: true,
      partName: 'https://example.com/a',
    });
    expect(validateExternalTarget('mailto:a@b.com').ok).toBe(true);
  });
  test('rejects unsafe schemes and relative/control forms', () => {
    expect(reason(validateExternalTarget('javascript:alert(1)'))).toBe('unsafe-scheme');
    expect(reason(validateExternalTarget('data:text/html,<x>'))).toBe('unsafe-scheme');
    expect(reason(validateExternalTarget('file:///etc/passwd'))).toBe('unsafe-scheme');
    expect(reason(validateExternalTarget('relative/path'))).toBe('not-absolute-uri');
    expect(reason(validateExternalTarget('\x01http://x'))).toBe('control-char');
  });
});
