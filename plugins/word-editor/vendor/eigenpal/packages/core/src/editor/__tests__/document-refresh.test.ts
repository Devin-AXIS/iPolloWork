import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createDocumentRefresh } from '../document-refresh.ts';
import { refreshHostFor } from '../document-refresh-host.ts';
import { refreshFixture, refreshMetadata } from './document-refresh-fixture.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function open() {
  const scroll = document.createElement('div');
  scroll.className = 'docx-editor__scroll-container';
  const container = document.createElement('div');
  scroll.append(container);
  document.body.append(scroll);
  Object.defineProperties(scroll, {
    scrollHeight: { value: 3000 },
    clientHeight: { value: 500 },
    scrollWidth: { value: 1200 },
    clientWidth: { value: 800 },
  });
  const editor = createDocxEditor({ container, document: refreshFixture() });
  const refresh = createDocumentRefresh(editor);
  disposers.push(() => {
    editor.destroy();
    scroll.remove();
  });
  return { editor, refresh, container, scroll, text: () => editor.surface?.session.bodyText() };
}

describe('external document refresh', () => {
  test('preserves the instance, subscriptions, viewport, and focus; resets undo', async () => {
    const { editor, refresh, scroll } = open();
    expect(createDocumentRefresh(editor)).toBe(refresh);
    editor.surface!.type('local');
    const submission = await refresh.capture();
    const sources: unknown[] = [];
    editor.on('change', (change) => sources.push(change.source));
    scroll.scrollTop = 900;
    scroll.scrollLeft = 80;
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: refreshMetadata(),
    });
    expect(result.ok).toBe(true);
    expect(scroll.scrollTop).toBe(900);
    expect(scroll.scrollLeft).toBe(80);
    expect(document.activeElement).toBe(button);
    button.remove();
    expect(editor.snapshot().canUndo).toBe(false);
    expect(sources).toEqual(['refresh']);
    expect(refresh.snapshot().changes[0]?.status).toBe('available');
  });
  test('highlights leave bytes and undo unchanged, then clear on local edits', async () => {
    const { editor, refresh, container } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: refreshMetadata(),
    });
    const bytes = await editor.save();
    refresh.highlightChanges({ animation: false });
    expect(container.querySelector('[data-docx-refresh-highlight]')).not.toBeNull();
    expect(await editor.save()).toEqual(bytes);
    expect(editor.snapshot().canUndo).toBe(false);
    refresh.clearHighlights();
    expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
    refresh.highlightChanges({ animation: false });
    editor.surface!.type('edit');
    expect(refresh.snapshot().changes).toEqual([]);
    expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
  });
  test('rejects local edits, including buffered input', async () => {
    const { editor, refresh, text } = open();
    const submission = await refresh.capture();
    editor.surface!.enqueueType('local');
    const result = await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) });
    expect(result).toMatchObject({ ok: false, code: 'local-edits' });
    expect(text()).toContain('local');
  });
  test('captures buffered input with its revision', async () => {
    const { editor, refresh } = open();
    editor.surface!.enqueueType('captured');
    const submission = await refresh.capture();
    const check = createDocxEditor({
      container: document.createElement('div'),
      document: submission.bytes,
    });
    expect(check.surface!.session.bodyText()).toContain('captured');
    check.destroy();
    expect(
      (await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(true);
  });
  test('rejects invalid bytes before tearing down the surface', async () => {
    const { editor, refresh } = open();
    const surface = editor.surface;
    const submission = await refresh.capture();
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: new Uint8Array([1]) })
    ).toMatchObject({ code: 'invalid-document' });
    expect(editor.surface).toBe(surface);
  });
  test('orders cumulative results by processor sequence and identifies only new changes', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: refreshMetadata(),
    });
    const second = await refresh.applyUpdate({
      submission,
      sequence: 3,
      bytes: refreshFixture(2),
      changes: refreshMetadata(2),
      failures: ['unavailable-source'],
    });
    expect(second).toMatchObject({ ok: true, failures: ['unavailable-source'] });
    expect(refresh.snapshot().changes.map((c) => c.isNew)).toEqual([false, true]);
    for (const sequence of [1, 2, 3])
      expect(
        await refresh.applyUpdate({ submission, sequence, bytes: refreshFixture(1) })
      ).toMatchObject({ code: 'out-of-order' });
  });
  test('serializes queued results and owns their byte arrays', async () => {
    const { refresh, text } = open();
    const submission = await refresh.capture();
    const bytes = refreshFixture(1);
    const first = refresh.applyUpdate({ submission, sequence: 1, bytes });
    bytes.fill(0);
    const second = refresh.applyUpdate({ submission, sequence: 2, bytes: refreshFixture(2) });
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(text()).toContain('Updated review date');
  });
  test('rejects cancelled, superseded, foreign, and switched submissions', async () => {
    const { editor, refresh } = open();
    const old = await refresh.capture();
    refresh.cancel();
    expect(
      (await refresh.applyUpdate({ submission: old, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(false);
    const next = await refresh.capture();
    await refresh.capture();
    expect(
      (await refresh.applyUpdate({ submission: next, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(false);
    const other = open();
    expect(
      (await other.refresh.applyUpdate({ submission: old, sequence: 1, bytes: refreshFixture(1) }))
        .ok
    ).toBe(false);
    const switched = await refresh.capture();
    editor.load(refreshFixture(2));
    expect(
      (await refresh.applyUpdate({ submission: switched, sequence: 1, bytes: refreshFixture(1) }))
        .ok
    ).toBe(false);
  });
  test('plain replacement reports unavailable change information', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
    ).toMatchObject({ ok: true, changeInformation: 'unavailable', changes: [] });
  });
  test('reports deleted, invalid, and unavailable locations without invented highlights', async () => {
    const { refresh, container } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: [
        { id: 'deleted', unavailableReason: 'deleted' },
        { id: 'unknown' },
        { id: 'invalid', location: { paragraphIndex: 12, start: 0, end: 3, text: 'bad' } },
      ],
    });
    expect(refresh.snapshot().changes.map((c) => c.status)).toEqual([
      'deleted',
      'unavailable',
      'invalid',
    ]);
    refresh.highlightChanges();
    expect(container.querySelector('[data-docx-refresh-highlight]')).toBeNull();
    expect(refresh.navigateToChange('deleted')).toBe(false);
  });
  test('preserves tracked revisions in saved and reopened bytes', async () => {
    const { editor, refresh } = open();
    const submission = await refresh.capture();
    await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1, false, true) });
    const saved = await editor.save();
    expect(readOoxmlPackage(new Uint8Array(saved)).ok).toBe(true);
    editor.load(saved);
    expect(await editor.save()).toEqual(saved);
  });
  test('matches paragraph IDs without case sensitivity and reports failed anchors', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    const location = { paragraphId: '0000000d', start: 12, end: 33, text: 'Updated delivery date' };
    const cases = [
      ['range', { ...location, paragraphId: '80000000' }, 'invalid-paragraph-id'],
      ['zero', { ...location, paragraphId: '00000000' }, 'invalid-paragraph-id'],
      ['syntax', { ...location, paragraphId: 'para-12' }, 'invalid-paragraph-id'],
      ['missing', { ...location, paragraphId: '7FFFFFFF' }, 'paragraph-not-found'],
      ['both', { ...location, paragraphIndex: 12 }, 'invalid-selector'],
      ['offset', { ...location, end: 999 }, 'invalid-offsets'],
      ['text', { ...location, text: 'Old delivery date' }, 'text-mismatch'],
    ] as const;
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes: [
        { id: 'matched', location },
        ...cases.map(([id, location]) => ({ id, location })),
        { id: 'footer', description: 'Updated footer version' },
        { id: 'deleted', description: 'Removed an obsolete clause', unavailableReason: 'deleted' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes[0]).toMatchObject({ status: 'available', location });
    expect(result.changes[0]?.diagnostic).toBeUndefined();
    for (const [id, requested, code] of cases) {
      const change = result.changes.find((c) => c.id === id)!;
      expect(change.status).toBe('invalid');
      expect(change.location).toBeUndefined();
      expect(change.diagnostic).toEqual({ code, location: requested });
      expect(Object.isFrozen(change.diagnostic)).toBe(true);
      expect(Object.isFrozen(change.diagnostic?.location)).toBe(true);
      expect(refresh.navigateToChange(id)).toBe(false);
    }
    expect(result.changes.find((c) => c.id === 'footer')).toMatchObject({
      description: 'Updated footer version',
      status: 'unavailable',
      diagnostic: { code: 'missing-location' },
    });
    expect(result.changes.find((c) => c.id === 'deleted')).toMatchObject({
      status: 'deleted',
      diagnostic: { code: 'deleted' },
    });
    expect(refresh.highlightChanges()).toBe(1);
    expect(result.failures).toEqual([]);
  });
  test('owns descriptions at delivery and detects changed structural summaries', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    const changes = [{ id: 'style', description: 'Heading size: 18 pt' }];
    const first = refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1),
      changes,
    });
    changes[0]!.description = 'Mutated after delivery';
    const accepted = await first;
    expect(accepted).toMatchObject({ ok: true, changes: [{ description: 'Heading size: 18 pt' }] });
    const second = await refresh.applyUpdate({
      submission,
      sequence: 2,
      bytes: refreshFixture(2),
      changes: [{ id: 'style', description: 'Heading size: 20 pt' }],
    });
    expect(second).toMatchObject({
      ok: true,
      changes: [{ isNew: true, description: 'Heading size: 20 pt' }],
    });
    expect(
      await refresh.applyUpdate({
        submission,
        sequence: 3,
        bytes: refreshFixture(2),
        changes: [{ id: 'style', description: 'x'.repeat(1001) }],
      })
    ).toMatchObject({ ok: false, code: 'invalid-result' });
  });
  test('refuses malformed metadata before replacing the document', async () => {
    const { refresh, text } = open();
    const before = text();
    const submission = await refresh.capture();
    for (const changes of [
      new Array(1),
      null,
      [{ id: 'bad', description: { text: 'not a string' } }],
      [{ id: 'bad', location: { paragraphIndex: 12, start: {}, end: 1, text: 'S' } }],
      [{ id: 'bad', location: null }],
    ]) {
      expect(
        await refresh.applyUpdate({
          submission,
          sequence: 1,
          bytes: refreshFixture(1),
          changes: changes as unknown as Parameters<typeof refresh.applyUpdate>[0]['changes'],
        })
      ).toMatchObject({ ok: false, code: 'invalid-result' });
      expect(text()).toBe(before);
    }
    expect(
      await refresh.applyUpdate({
        submission,
        sequence: 1,
        bytes: refreshFixture(1),
        failures: new Array(1),
      })
    ).toMatchObject({ ok: false, code: 'invalid-result' });
    expect(text()).toBe(before);
    expect(
      await refresh.applyUpdate({
        submission,
        sequence: 1,
        bytes: refreshFixture(1),
        changes: refreshMetadata(),
      })
    ).toMatchObject({ ok: true });
  });
  test('locates table cells and block content controls in returned files', async () => {
    const { editor, refresh } = open();
    const files = unzipSync(refreshFixture());
    const nested =
      '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
      '<w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
      '<w:p w14:paraId="00ABCDEF"><w:r><w:t>Updated table cell</w:t></w:r></w:p>' +
      '</w:tc></w:tr></w:tbl><w:sdt><w:sdtPr><w:richText/></w:sdtPr><w:sdtContent>' +
      '<w:p w14:paraId="00ABCDE0"><w:r><w:t>Updated control</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>';
    files['word/document.xml'] = strToU8(
      strFromU8(files['word/document.xml']!).replace('<w:body>', `<w:body>${nested}`)
    );
    const submission = await refresh.capture();
    const result = await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: zipSync(files),
      changes: [
        {
          id: 'table',
          description: 'Updated table cell',
          location: { paragraphId: '00abcdef', start: 0, end: 18, text: 'Updated table cell' },
        },
        {
          id: 'control',
          description: 'Updated content control',
          location: { paragraphIndex: 1, start: 0, end: 15, text: 'Updated control' },
        },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      changes: [{ status: 'available' }, { status: 'available' }],
    });
    expect(refresh.highlightChanges({ timeoutMs: 5000 })).toBe(2);
    expect(refresh.navigateToChange('table')).toBe(true);
    expect(refresh.navigateToChange('control')).toBe(true);
    const saved = await editor.save();
    editor.load(saved);
    expect(editor.surface!.session.bodyText()).toContain('Updated table cell');
    expect(editor.surface!.session.bodyText()).toContain('Updated control');
  });
  test('blocks writes during deferred loads and restores scroll on completion', async () => {
    const { editor, refresh, scroll } = open();
    const submission = await refresh.capture();
    scroll.scrollTop = 700;
    const applying = refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1, true),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh.snapshot().phase).toBe('refreshing');
    expect(editor.snapshot().isOpening).toBe(false);
    editor.surface!.type('must not land');
    expect(editor.surface!.session.bodyText()).not.toContain('must not land');
    expect((await applying).ok).toBe(true);
    expect(scroll.scrollTop).toBe(700);
  });
  test('cancels a deferred load without replacing content', async () => {
    const { editor, refresh, text } = open();
    const submission = await refresh.capture();
    const applying = refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1, true),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(refresh.snapshot().phase).toBe('refreshing');
    expect(editor.snapshot().isOpening).toBe(false);
    refresh.cancel();
    expect(await applying).toMatchObject({ code: 'cancelled' });
    expect(text()).not.toContain('Updated delivery');
    editor.surface!.type('works');
    expect(text()).toContain('works');
  });
  test('never restores over a later document switch', async () => {
    const { editor, refresh, text } = open();
    const submission = await refresh.capture();
    const applying = refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: refreshFixture(1, true),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    editor.load(refreshFixture(2));
    expect(await applying).toMatchObject({ code: 'document-changed' });
    expect(text()).toContain('Updated review');
  });
  test('recovers after mount failure and reports the result identity', async () => {
    const { editor, refresh, container, scroll, text } = open();
    scroll.scrollTop = 700;
    const submission = await refresh.capture();
    const original = container.replaceChildren.bind(container);
    let failed = false;
    container.replaceChildren = (...nodes) => {
      if (nodes.length && !failed) {
        failed = true;
        scroll.scrollTop = 0;
        throw new Error('mount failed');
      }
      original(...nodes);
    };
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
    ).toMatchObject({
      ok: false,
      code: 'load-failed',
      recovered: true,
      resultId: `${submission.id}:1`,
    });
    expect(scroll.scrollTop).toBe(700);
    expect(text()).toContain('Project schedule');
    expect(editor.surface).not.toBeNull();
  });
  test('retains recovery bytes and supports retry after two mount failures', async () => {
    const { refresh, container } = open();
    const submission = await refresh.capture();
    const original = container.replaceChildren.bind(container);
    container.replaceChildren = (...nodes) => {
      if (nodes.length) throw new Error('mount failed');
      original(...nodes);
    };
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
    ).toMatchObject({ code: 'recovery-failed' });
    expect(refresh.recoveryBytes()).not.toBeNull();
    expect(refresh.snapshot().recoveryAvailable).toBe(true);
    container.replaceChildren = original;
    expect(await refresh.recover()).toBe(true);
    expect(refresh.recoveryBytes()).toBeNull();
  });
  test('refuses a collaborative reload even when its connection is unavailable', async () => {
    const { editor, refresh } = open();
    refreshHostFor(editor).collaboration = () => true;
    // Capture serves an undoable edit too, so only the reload refuses.
    const submission = await refresh.capture();
    expect(
      await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
    ).toMatchObject({ ok: false, code: 'collaboration' });
    expect(editor.surface!.session.bodyText()).not.toContain('Updated delivery');
    editor.load(refreshFixture(1));
    expect(editor.surface!.session.bodyText()).toContain('Updated delivery');
  });
  test('notifies for refusal without letting host observers break completion', async () => {
    const { refresh } = open();
    const submission = await refresh.capture();
    const ids: string[] = [];
    refresh.onResult((result) => {
      ids.push(result.resultId);
      throw new Error('host');
    });
    refresh.subscribe(() => {
      throw new Error('host');
    });
    expect(
      (await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })).ok
    ).toBe(true);
    await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) });
    expect(ids).toHaveLength(2);
  });
});
