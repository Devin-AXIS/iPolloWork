// Faces an origin delivers after the first paint (`FontConfigurationFragment.deferred`).
//
// - composition answers the immediate faces now and keeps the late ones on `deferred`
// - the late answer is the whole composition again, with first-wins precedence intact
// - a late answer that fails is reported, and the immediate faces stay
// - export composition (`awaitDeferred`) answers once, with every face
// - a complete late answer replaces the immediate one; a partial one adds to it

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { FontSource } from '../../contracts/editor.ts';
import { sha256FontBytes } from '../font-resource.ts';
import type { FontConfigurationFragment } from '../font-composition.ts';
import { deferFonts } from '../defer-fonts.ts';
import { markCompleteAnswer, mergeDeferredAnswer } from '../font-deferred.ts';
import {
  composeFontOrigins,
  composePreparedFontOrigins,
  defineFontResolver,
  type FontOriginFailure,
} from '../font-resolver.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const hash = sha256FontBytes(bytes);
const source = (family: string, id: string): FontSource => ({
  request: { family, weight: 400, style: 'normal' },
  id,
  bytes,
  hash,
  faceIndex: 0,
});
const request = { families: ['Early', 'Late'], defaultFamily: 'Calibri' };
const ids = (fragment: FontConfigurationFragment | undefined) =>
  (fragment?.sources ?? []).map((entry) => entry.id).sort();

function settleable<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('deferred font faces', () => {
  test('composition answers now and keeps the late faces on deferred', async () => {
    const late = settleable<FontConfigurationFragment | undefined>();
    const composed = await composeFontOrigins(
      [
        { sources: [source('Early', 'early')] },
        defineFontResolver(() => ({ sources: [], deferred: late.promise })),
      ],
      request
    );
    expect(ids(composed)).toEqual(['early']);
    expect(composed?.deferred).toBeInstanceOf(Promise);
    late.resolve({ sources: [source('Late', 'late')] });
    const full = await composed!.deferred;
    expect(ids(full)).toEqual(['early', 'late']);
    expect(full?.deferred).toBeUndefined();
  });

  test('an earlier origin still wins a face a later origin delivers late', async () => {
    const composed = await composeFontOrigins(
      [
        defineFontResolver(() => ({
          sources: [],
          deferred: Promise.resolve({ sources: [source('Shared', 'first')] }),
        })),
        { sources: [source('Shared', 'second')] },
      ],
      { families: ['Shared'], defaultFamily: 'Calibri' }
    );
    expect(ids(composed)).toEqual(['second']);
    expect(ids(await composed!.deferred)).toEqual(['first']);
  });

  test('a late answer that rejects is reported, and nothing new installs', async () => {
    const failures: FontOriginFailure[] = [];
    const composed = await composeFontOrigins(
      [
        { sources: [source('Early', 'early')] },
        defineFontResolver(() => ({
          sources: [],
          deferred: Promise.reject(new Error('late failure')),
        })),
      ],
      request,
      { onOriginFailure: (failure) => failures.push(failure) }
    );
    expect(ids(composed)).toEqual(['early']);
    // The immediate faces are already installed; a failed arrival adds no layout pass.
    expect(await composed!.deferred).toBeUndefined();
    expect(failures.map((failure) => failure.originIndex)).toEqual([1]);
  });

  test('a cancelled composition settles its late answer to undefined', async () => {
    const controller = new AbortController();
    const late = settleable<FontConfigurationFragment | undefined>();
    const composed = await composeFontOrigins(
      [defineFontResolver(() => ({ sources: [], deferred: late.promise }))],
      { ...request, signal: controller.signal }
    );
    controller.abort(new Error('next document'));
    late.resolve({ sources: [source('Late', 'late')] });
    expect(await composed!.deferred).toBeUndefined();
  });

  test('a nested composition passes its late faces through', async () => {
    const inner = defineFontResolver((next) =>
      composeFontOrigins(
        [
          defineFontResolver(() => ({
            deferred: Promise.resolve({ sources: [source('Late', 'late')] }),
          })),
        ],
        next
      )
    );
    const composed = await composeFontOrigins(
      [{ sources: [source('Early', 'early')] }, inner],
      request
    );
    expect(ids(composed)).toEqual(['early']);
    expect(ids(await composed!.deferred)).toEqual(['early', 'late']);
  });

  test('deferFonts moves any origin to the late answer', async () => {
    const composed = await composeFontOrigins(
      [{ sources: [source('Early', 'early')] }, deferFonts({ sources: [source('Late', 'late')] })],
      request
    );
    expect(ids(composed)).toEqual(['early']);
    expect(ids(await composed!.deferred)).toEqual(['early', 'late']);
  });

  test('deferFonts settles to nothing and reports when its origin fails', async () => {
    const failures: FontOriginFailure[] = [];
    const composed = await composeFontOrigins(
      [
        deferFonts(
          defineFontResolver(() => {
            throw new Error('offline');
          })
        ),
      ],
      request,
      { onOriginFailure: (failure) => failures.push(failure) }
    );
    expect(ids(await composed!.deferred)).toEqual([]);
    expect(failures.map((failure) => String(failure.cause))).toEqual(['Error: offline']);
  });

  test('export composition waits and answers every face at once', async () => {
    const composed = await composePreparedFontOrigins(
      [
        { sources: [source('Early', 'early')] },
        defineFontResolver(() => ({
          sources: [],
          deferred: Promise.resolve({ sources: [source('Late', 'late')] }),
        })),
      ],
      request,
      { awaitDeferred: true }
    );
    expect(ids(composed)).toEqual(['early', 'late']);
    expect(composed?.deferred).toBeUndefined();
  });

  test('export composition reports a late origin that failed', async () => {
    const failures: FontOriginFailure[] = [];
    await composePreparedFontOrigins(
      [
        deferFonts(
          defineFontResolver(() => {
            throw new Error('offline');
          })
        ),
      ],
      request,
      { awaitDeferred: true, onOriginFailure: (failure) => failures.push(failure) }
    );
    expect(failures.map((failure) => String(failure.cause))).toEqual(['Error: offline']);
  });

  test('a fast late origin installs without waiting for a slow one', async () => {
    const slow = settleable<FontConfigurationFragment | undefined>();
    const composed = await composeFontOrigins(
      [
        defineFontResolver(() => ({ sources: [], deferred: slow.promise })),
        deferFonts({ sources: [source('Late', 'late')] }),
      ],
      request
    );
    const first = await composed!.deferred;
    expect(ids(first)).toEqual(['late']);
    expect(first?.deferred).toBeInstanceOf(Promise);
    slow.resolve({ sources: [source('Early', 'early')] });
    expect(ids(await first!.deferred)).toEqual(['early', 'late']);
  });

  test('an immediate drop is reported once, not again when late faces arrive', async () => {
    const failures: FontOriginFailure[] = [];
    const composed = await composeFontOrigins(
      [
        { sources: [source('Early', 'early'), { ...source('Broken', 'broken'), faceIndex: -1 }] },
        deferFonts({ sources: [source('Late', 'late')] }),
      ],
      request,
      { onOriginFailure: (failure) => failures.push(failure) }
    );
    const before = failures.length;
    expect(before).toBeGreaterThan(0);
    expect(ids(await composed!.deferred)).toEqual(['early', 'late']);
    expect(failures).toHaveLength(before);
  });

  test('a late origin that brings nothing causes no new composition', async () => {
    const composed = await composeFontOrigins(
      [
        { sources: [source('Early', 'early')] },
        defineFontResolver(() => ({ sources: [], deferred: Promise.resolve({ sources: [] }) })),
      ],
      request
    );
    expect(await composed!.deferred).toBeUndefined();
  });

  test('export stops waiting for a late promise when it is cancelled', async () => {
    const controller = new AbortController();
    const composing = composePreparedFontOrigins(
      [defineFontResolver(() => ({ sources: [], deferred: new Promise(() => {}) }))],
      { ...request, signal: controller.signal },
      { awaitDeferred: true }
    );
    controller.abort(new Error('deadline'));
    await expect(composing).rejects.toThrow('deadline');
  });

  test('a deferred origin keeps its family catalog', async () => {
    const composed = await composeFontOrigins(
      [deferFonts({ supportedFamilies: ['Late'], sources: [source('Late', 'late')] })],
      request
    );
    expect((await composed!.deferred)?.supportedFamilies).toContain('Late');
  });

  test('an origin that holds everything back is not the composition base', async () => {
    const composed = await composeFontOrigins(
      [
        deferFonts({ sources: [source('Late', 'late')] }),
        {
          sources: [source('Early', 'early')],
          defaultFont: { family: 'Early', sizeHalfPoints: 24 },
        },
      ],
      request
    );
    expect((composed as { defaultFont?: unknown }).defaultFont).toEqual({
      family: 'Early',
      sizeHalfPoints: 24,
    });
  });

  test("a composed resolver's late answer replaces its immediate one, never doubles it", async () => {
    const inner = defineFontResolver((next) =>
      composeFontOrigins(
        [
          { sources: [source('Early', 'early')] },
          deferFonts({ sources: [source('Late', 'late')] }),
        ],
        next
      )
    );
    const exported = await composePreparedFontOrigins([inner], request, { awaitDeferred: true });
    expect(ids(exported)).toEqual(['early', 'late']);
    const composed = await composeFontOrigins([inner], request);
    expect(ids(await composed!.deferred)).toEqual(['early', 'late']);
  });

  test('export copies sources an editor composition already prepared', async () => {
    const editorSide = await composeFontOrigins([{ sources: [source('Early', 'early')] }], request);
    let copies = 0;
    const exported = await composePreparedFontOrigins([editorSide], request, {
      instrumentation: { onOwnedByteCopy: () => copies++ },
    });
    expect(copies).toBe(1);
    expect(exported!.sources![0]!.bytes).not.toBe(editorSide!.sources![0]!.bytes);
  });

  test('a complete late answer replaces the immediate one it contains', () => {
    const now = { sources: [source('Early', 'early')] };
    const full = markCompleteAnswer({
      sources: [source('Early', 'early'), source('Late', 'late')],
    });
    const sourceIds = (answer: ReturnType<typeof mergeDeferredAnswer>) =>
      answer?.sources?.map((entry) => entry.id);
    expect(sourceIds(mergeDeferredAnswer(now, full))).toEqual(['early', 'late']);
    expect(sourceIds(mergeDeferredAnswer(now, { sources: [source('Late', 'late')] }))).toEqual([
      'late',
      'early',
    ]);
  });

  test('a held-back origin stays out of the base when its faces arrive', async () => {
    const aptos = { family: 'Aptos', sizeHalfPoints: 22 };
    const composed = await composeFontOrigins(
      [
        deferFonts({ sources: [source('Late', 'late')] }),
        { sources: [source('Early', 'early')], defaultFont: aptos },
      ],
      request
    );
    expect((composed as { defaultFont?: unknown }).defaultFont).toEqual(aptos);
    const full = await composed!.deferred;
    expect((full as { defaultFont?: unknown }).defaultFont).toEqual(aptos);
    expect(ids(full)).toEqual(['early', 'late']);
  });

  test('deferFonts alone still installs its faces when they arrive', async () => {
    const composed = await composeFontOrigins(
      [deferFonts({ sources: [source('Late', 'late')] })],
      request
    );
    expect(ids(await composed!.deferred)).toEqual(['late']);
  });

  test('export reports the immediate failures of an origin that also defers', async () => {
    const failures: FontOriginFailure[] = [];
    await composePreparedFontOrigins(
      [
        defineFontResolver(() => ({
          sources: [source('Early', 'early')],
          failures: [new Error('one face missing')],
          deferred: Promise.resolve({ sources: [source('Late', 'late')] }),
        })),
      ],
      request,
      { awaitDeferred: true, onOriginFailure: (failure) => failures.push(failure) }
    );
    expect(failures.map((failure) => String(failure.cause))).toContain('Error: one face missing');
  });

  test('an origin skipped as invalid does not merge its late faces, and says so', async () => {
    const failures: FontOriginFailure[] = [];
    const composed = await composeFontOrigins(
      [
        { sources: [source('Early', 'early')] },
        defineFontResolver(
          () =>
            ({
              sources: 'not a list',
              deferred: Promise.resolve({ sources: [source('Late', 'late')] }),
            }) as never
        ),
      ],
      request,
      { onOriginFailure: (failure) => failures.push(failure) }
    );
    expect(composed?.deferred).toBeUndefined();
    expect(failures.some((failure) => String(failure.cause).includes('background faces'))).toBe(
      true
    );
  });

  test('export keeps the default font of the origin after a held-back one', async () => {
    const aptos = { family: 'Aptos', sizeHalfPoints: 22 };
    const composed = await composePreparedFontOrigins(
      [
        deferFonts({ sources: [source('Late', 'late')] }),
        { sources: [source('Early', 'early')], defaultFont: aptos },
      ],
      request,
      { awaitDeferred: true }
    );
    expect((composed as { defaultFont?: unknown }).defaultFont).toEqual(aptos);
    expect(ids(composed)).toEqual(['early', 'late']);
  });

  test('a late answer never changes the default font', async () => {
    const composed = await composeFontOrigins(
      [
        defineFontResolver(() => ({
          sources: [source('Early', 'early')],
          deferred: Promise.resolve({
            sources: [source('Late', 'late')],
            defaultFont: { family: 'Late', sizeHalfPoints: 30 },
          } as FontConfigurationFragment),
        })),
      ],
      request
    );
    const before = (composed as { defaultFont?: { family: string } }).defaultFont?.family;
    const after = ((await composed!.deferred) as { defaultFont?: { family: string } }).defaultFont
      ?.family;
    expect(after).toBe(before);
  });
});
