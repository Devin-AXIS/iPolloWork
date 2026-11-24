// `replaceAllMatches` skips what it must not write, without paying a commit to find it.
//
// Locks were found only by a failed commit, and each failed commit applies the ops and lays the
// story out, so spread-out locks made the halving retry quadratic. Struck text was replaced
// again: a second run after a tracked replacement stacked a second proposal on the struck
// word, and editing mode turned another author's pending deletion into plain text. A run that
// stopped part-way reported success.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';
import { bodyXml, everyStoryDocx, mount, storyXml } from './replace-all-matches-fixture.ts';

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lockedParagraph = (text: string) =>
  '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
  `${paragraph(text)}</w:sdtContent></w:sdt>`;

/** Count the surface's automation commits, and optionally refuse some of them. */
function countCommits(
  surface: PaginatedSurface,
  refuse?: (scope: Parameters<PaginatedSurface['applyAutomationOps']>[1]) => string | null
): { readonly count: number } {
  const original = surface.applyAutomationOps.bind(surface);
  const counter = { count: 0 };
  surface.applyAutomationOps = (staged, scope, ...rest) => {
    counter.count += 1;
    const reason = refuse?.(scope) ?? null;
    if (reason !== null) return { committed: false, rejected: true, opCount: 0, reason };
    return original(staged, scope, ...rest);
  };
  return counter;
}

const deletion =
  '<w:del w:id="9" w:author="Alan Turing" w:date="2026-01-01T00:00:00Z">' +
  '<w:r><w:delText>cd</w:delText></w:r></w:del>';
const struckBody = `<w:p><w:r><w:t>ab</w:t></w:r>${deletion}<w:r><w:t>ef</w:t></w:r></w:p>`;

describe('locked matches are found before committing', () => {
  test('1000 paragraphs, every other locked, take one commit', () => {
    const body = Array.from({ length: 1000 }, (_, index) =>
      index % 2 === 0 ? paragraph(`term ${index}`) : lockedParagraph(`term ${index}`)
    ).join('');
    const { editor, dispose } = mount(body);
    try {
      const commits = countCommits(editor.surface!);
      expect(editor.exec({ type: 'replaceAllMatches', query: 'term', text: 'word' })).toMatchObject(
        { ok: true, replacements: { replaced: 500, skipped: 500 } }
      );
      expect(commits.count).toBe(1);
      expect(editor.findMatches('word').length).toBe(500);
    } finally {
      dispose();
    }
  });

  test('only locked matches refuse without a commit', () => {
    const body = Array.from({ length: 200 }, (_, index) => lockedParagraph(`term ${index}`)).join(
      ''
    );
    const { editor, dispose } = mount(body);
    try {
      const commits = countCommits(editor.surface!);
      expect(editor.exec({ type: 'replaceAllMatches', query: 'term', text: 'word' })).toMatchObject(
        { ok: false, code: 'locked' }
      );
      expect(commits.count).toBe(0);
    } finally {
      dispose();
    }
  });

  test('the refusal fallback is bounded and says it stopped', () => {
    const body = Array.from({ length: 300 }, (_, index) => paragraph(`term ${index}`)).join('');
    const { editor, dispose } = mount(body);
    try {
      const before = bodyXml(editor);
      // A rule the range checks do not ask: every commit is refused.
      const commits = countCommits(editor.surface!, () => 'locked');
      const result = editor.exec({ type: 'replaceAllMatches', query: 'term', text: 'word' });
      expect(result).toMatchObject({ ok: false });
      if (result.ok) throw new Error('expected a refusal');
      expect(result.reason).toContain('too many');
      // One story commit plus at most 32 fallback commits.
      expect(commits.count).toBeLessThanOrEqual(33);
      expect(bodyXml(editor)).toBe(before);
    } finally {
      dispose();
    }
  });
});

describe('struck text is skipped', () => {
  test('a second run after a tracked replacement replaces nothing', () => {
    const { editor, dispose } = mount(paragraph('Beta'));
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const command = { type: 'replaceAllMatches' as const, query: 'Beta', text: 'Zeta' };
      expect(editor.exec(command)).toMatchObject({
        ok: true,
        replacements: { replaced: 1, skipped: 0 },
      });
      const once = bodyXml(editor);
      expect(editor.exec(command)).toEqual({
        ok: true,
        changed: false,
        replacements: { replaced: 0, skipped: 1 },
      });
      expect(bodyXml(editor)).toBe(once);
      expect(once).not.toContain('ZetaZeta');
    } finally {
      dispose();
    }
  });

  test("a match across another author's deletion is skipped in suggesting mode", () => {
    const { editor, dispose } = mount(struckBody);
    try {
      expect(editor.setEditingMode('suggesting').ok).toBe(true);
      const before = bodyXml(editor);
      expect(editor.findMatches('bcde').length).toBe(1);
      expect(editor.exec({ type: 'replaceAllMatches', query: 'bcde', text: 'X' })).toEqual({
        ok: true,
        changed: false,
        replacements: { replaced: 0, skipped: 1 },
      });
      expect(bodyXml(editor)).toBe(before);
    } finally {
      dispose();
    }
  });

  test('editing mode keeps an existing tracked deletion', () => {
    const { editor, dispose } = mount(struckBody);
    try {
      const before = bodyXml(editor);
      expect(editor.exec({ type: 'replaceAllMatches', query: 'cd', text: 'X' })).toMatchObject({
        ok: true,
        changed: false,
        replacements: { replaced: 0, skipped: 1 },
      });
      expect(bodyXml(editor)).toBe(before);
      expect(bodyXml(editor)).toContain('w:author="Alan Turing"');
      // Live text beside the deletion is still replaced.
      expect(editor.exec({ type: 'replaceAllMatches', query: 'ab', text: 'X' })).toMatchObject({
        ok: true,
        replacements: { replaced: 1, skipped: 0 },
      });
      expect(bodyXml(editor)).toContain('<w:delText>cd</w:delText>');
    } finally {
      dispose();
    }
  });
});

describe('a run that stops part-way', () => {
  test('is refused with the replaced count, and what landed undoes in one step', () => {
    const { editor, dispose } = mount(everyStoryDocx());
    try {
      const before = storyXml(editor);
      // The body story is written last; its commit fails as a dropped connection would.
      const commits = countCommits(editor.surface!, (scope) =>
        (scope?.kind ?? 'body') === 'body' ? 'transport-disconnected' : null
      );
      const result = editor.exec({
        type: 'replaceAllMatches',
        query: 'Beta',
        text: 'Zeta',
        matchCase: true,
      });
      expect(result).toMatchObject({ ok: false, code: 'unsupported' });
      if (result.ok) throw new Error('expected a refusal');
      expect(result.reason).toContain('stopped after 4 replacements');
      // Header, footer, footnote, endnote landed; body, cell, and text box did not.
      expect(result.replacements).toEqual({ replaced: 4, skipped: 0 });
      expect(commits.count).toBe(5);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(storyXml(editor)).toEqual(before);
    } finally {
      dispose();
    }
  });
});
