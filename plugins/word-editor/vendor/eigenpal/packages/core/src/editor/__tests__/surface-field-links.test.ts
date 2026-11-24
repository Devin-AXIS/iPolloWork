// The field-link registry: HYPERLINK instructions crossing the surface trust boundary.
//
// The raw target is attacker-controlled. Everything a DOM sink could see comes out of this
// registry already sanitized, and every minted id resolves back to its record so a click on
// the painted anchor means something.

import { describe, expect, test } from 'bun:test';
import { createFieldLinkRegistry } from '../surface-field-links.ts';

describe('projecting a field link', () => {
  test('an absolute allowlisted target becomes an external record', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'https://example.com/Path%20A',
      anchor: null,
      tooltip: 'Visit',
    });
    expect(record).toEqual({
      id: 'field-hyperlink:1',
      kind: 'external',
      href: 'https://example.com/Path%20A',
      tooltip: 'Visit',
    });
  });

  test('a javascript: target with an \\l anchor falls back to the anchor', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'javascript:alert(1)',
      anchor: 'section3',
      tooltip: null,
    });
    expect(record).toMatchObject({ kind: 'internal', href: '#section3', anchor: 'section3' });
  });

  test('a target AND an \\l anchor carry the anchor as a #fragment on the external href', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'https://example.com/p',
      anchor: 'sec2',
      tooltip: null,
    });
    expect(record).toMatchObject({ kind: 'external', href: 'https://example.com/p#sec2' });
  });

  test('a target that already carries a # keeps its own fragment (target-wins)', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'https://example.com/p#top',
      anchor: 'sec2',
      tooltip: null,
    });
    expect(record).toMatchObject({ kind: 'external', href: 'https://example.com/p#top' });
  });

  test('a control char in the \\l anchor never reaches the #fragment', () => {
    const registry = createFieldLinkRegistry();
    const external = registry.project({
      target: 'https://example.com/p',
      anchor: 'se\x00c',
      tooltip: null,
    });
    expect(external).toMatchObject({ kind: 'external', href: 'https://example.com/p#sec' });
    const internal = registry.project({ target: null, anchor: 'se\x00c', tooltip: null });
    expect(internal).toMatchObject({ kind: 'internal', href: '#sec', anchor: 'sec' });
  });

  test('a control char in the \\o tooltip never reaches the title', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'https://example.com',
      anchor: null,
      tooltip: 'a\x01b',
    });
    expect(record).toMatchObject({ tooltip: 'ab' });
  });

  test('a javascript: target with no anchor projects nothing', () => {
    const registry = createFieldLinkRegistry();
    expect(registry.project({ target: 'javascript:alert(1)', anchor: null, tooltip: null })).toBe(
      null
    );
  });

  test('a smuggled scheme is refused after the control characters are stripped', () => {
    const registry = createFieldLinkRegistry();
    expect(
      registry.project({ target: 'java\tscript:alert(1)', anchor: null, tooltip: null })
    ).toBeNull();
  });

  test('a relative target is refused — it would resolve against the host origin', () => {
    const registry = createFieldLinkRegistry();
    expect(registry.project({ target: 'evil/page.html', anchor: null, tooltip: null })).toBeNull();
    expect(registry.project({ target: '//evil.example', anchor: null, tooltip: null })).toBeNull();
  });

  test('an anchor-only spec is an internal record with a sanitized fragment', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({ target: null, anchor: 'top', tooltip: null });
    expect(record).toMatchObject({ kind: 'internal', href: '#top', anchor: 'top' });
  });

  test('a hostile anchor keeps the link inert but present', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: null,
      anchor: 'javascript:alert(1)',
      tooltip: null,
    });
    expect(record).toMatchObject({ kind: 'internal', href: null });
  });
});

describe('identity and resolution', () => {
  test('the same spec projects the same id; a different spec a different one', () => {
    const registry = createFieldLinkRegistry();
    const spec = { target: 'https://example.com', anchor: null, tooltip: null };
    const first = registry.project(spec)!;
    const again = registry.project({ ...spec })!;
    const other = registry.project({
      target: 'https://other.example',
      anchor: null,
      tooltip: null,
    })!;
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });

  test('repeated projection of one spec never churns the id', () => {
    const registry = createFieldLinkRegistry();
    const spec = { target: 'https://example.com', anchor: null, tooltip: null };
    const first = registry.project(spec)!;
    for (let i = 0; i < 8; i += 1) {
      expect(registry.project({ ...spec })!.id).toBe(first.id);
    }
  });

  test('a minted id resolves back to a record a click can act on', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'https://example.com',
      anchor: null,
      tooltip: 'Visit',
    })!;
    const resolved = registry.linkById(record.id);
    expect(resolved).toMatchObject({
      id: record.id,
      kind: 'external',
      href: 'https://example.com',
      authored: 'https://example.com',
      tooltip: 'Visit',
    });
    // No `w:hyperlink` node backs it, so it addresses no range the editing lane could touch.
    expect(resolved!.paragraphId).toBe('');
    expect(registry.linkById('field-hyperlink:999')).toBeNull();
  });
});

describe('the registration cap', () => {
  test('past 4096 distinct links, a NEW target projects nothing — never an unresolvable id', () => {
    const registry = createFieldLinkRegistry();
    for (let i = 1; i <= 4096; i += 1) {
      const record = registry.project({
        target: `https://example.com/${i}`,
        anchor: null,
        tooltip: null,
      });
      expect(record).not.toBeNull();
      expect(registry.linkById(record!.id)).not.toBeNull();
    }
    // The 4097th distinct target is refused, and CONSISTENTLY so: its text paints plain
    // rather than as an anchor whose clicks resolve to nothing, and no per-call fresh id
    // exists to churn an unchanged line's fragment signature on re-break.
    const overflow = { target: 'https://overflow.example', anchor: null, tooltip: null };
    expect(registry.project(overflow)).toBeNull();
    expect(registry.project({ ...overflow })).toBeNull();
  });

  test('at the cap, a KNOWN key keeps returning its registered id and record', () => {
    const registry = createFieldLinkRegistry();
    const first = registry.project({
      target: 'https://example.com/1',
      anchor: null,
      tooltip: null,
    })!;
    for (let i = 2; i <= 4096; i += 1) {
      registry.project({ target: `https://example.com/${i}`, anchor: null, tooltip: null });
    }
    const again = registry.project({
      target: 'https://example.com/1',
      anchor: null,
      tooltip: null,
    })!;
    expect(again.id).toBe(first.id);
    expect(registry.linkById(first.id)).toMatchObject({ href: 'https://example.com/1' });
  });
});
