// Faces an origin delivers after the first paint (`FontConfigurationFragment.deferred`).
//
// Composition answers in two steps. The first answer holds every origin's immediate faces.
// Its `deferred` settles to the whole composition again, with each origin's late faces
// merged into its own position, so first-wins precedence is the same in both answers.

import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import type { FontConfigurationFragment } from './font-composition.ts';

type OriginAnswer = FontConfiguration | FontConfigurationFragment;

/** The answer without its late faces, and the late faces, when it has any. */
export function splitDeferredAnswer<T extends OriginAnswer>(
  answer: T
): { readonly now: T; readonly later?: Promise<FontConfigurationFragment | undefined> } {
  const later = 'deferred' in answer ? answer.deferred : undefined;
  if (later === undefined) return { now: answer };
  const { deferred: _later, ...now } = answer as FontConfigurationFragment;
  // A host answer is untrusted shape: anything without `then` is not a pending answer. A
  // thenable becomes a real promise with a handler attached, so a rejection that nothing
  // reaches (a later origin aborting the composition) is never an unhandled rejection.
  if (typeof (later as { then?: unknown } | null)?.then !== 'function') return { now: now as T };
  const pending = Promise.resolve(later);
  pending.catch(() => undefined);
  return { now: now as T, later: pending };
}

/**
 * Late answers that are a whole composition again, not just held-back faces. Merging one
 * REPLACES the immediate answer it grew from, which it already contains in first-wins order;
 * appending it would list every face twice. Keyed by identity, so only Core can mark one.
 */
const completeAnswers = new WeakSet<object>();

/** Mark `answer` as a whole composition; see {@link mergeDeferredAnswer}. */
export function markCompleteAnswer<T extends object | undefined>(answer: T): T {
  if (answer) completeAnswers.add(answer);
  return answer;
}

/**
 * One origin's immediate answer with its late one merged in. A complete answer (a composed
 * resolver's) replaces the immediate faces. Otherwise the late faces are the ones the origin
 * held back and are added, ahead of the immediate ones. Configuration settings
 * (`defaultFont`, `maxFontBytes`) always stay the immediate answer's. Neither answer's
 * `failures` is carried: each was reported where it arrived.
 */
export function mergeDeferredAnswer(
  now: OriginAnswer | undefined,
  later: FontConfigurationFragment | undefined
): OriginAnswer | undefined {
  if (!later) return now;
  // Faces and catalogs only: the configuration settings (`defaultFont`, `maxFontBytes`,
  // `language`) stay the immediate answer's, so the default font never changes after paint.
  const base = now ? (withoutReportedFailures(now) as FontConfigurationFragment) : undefined;
  const next = later.deferred ? { deferred: later.deferred } : {};
  const complete = completeAnswers.has(later);
  const catalogs = complete
    ? (later.supportedFamilies ?? [])
    : [...(later.supportedFamilies ?? []), ...(base?.supportedFamilies ?? [])];
  return {
    ...base,
    sources: complete
      ? (later.sources ?? [])
      : [...(later.sources ?? []), ...(base?.sources ?? [])],
    substitutions: complete
      ? (later.substitutions ?? [])
      : [...(later.substitutions ?? []), ...(base?.substitutions ?? [])],
    // A complete answer's catalog replaces the immediate one, even when it is empty.
    supportedFamilies: catalogs.length > 0 ? [...new Set(catalogs)] : undefined,
    ...next,
  };
}

/** Whether a late answer brings anything to install: faces, substitutions, or more to come. */
export function lateAnswerHasFaces(answer: FontConfigurationFragment | undefined): boolean {
  return (
    !!answer &&
    ((answer.sources?.length ?? 0) > 0 ||
      (answer.substitutions?.length ?? 0) > 0 ||
      answer.deferred !== undefined)
  );
}

/** The partial failures a late answer carries, bounded; empty when it carries none. */
export function lateAnswerFailures(answer: FontConfigurationFragment | undefined): unknown[] {
  const failures =
    answer && 'failures' in answer ? (answer as { failures?: unknown }).failures : undefined;
  return Array.isArray(failures) ? failures.slice(0, 256) : [];
}

/** Settle like `work`, or reject with the abort reason as soon as `signal` aborts. */
export function raceAbort<T>(work: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return Promise.resolve(work);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(cause);
      }
    );
  });
}

/**
 * Await an answer's late faces, and theirs, into one answer. For callers that need the
 * complete set at once, such as document export. A failed or rejected late answer leaves
 * the faces that did arrive.
 */
export async function completeDeferredAnswer<T extends OriginAnswer>(
  answer: T,
  onFailure: (cause: unknown) => void,
  signal?: AbortSignal
): Promise<T> {
  // The merges below drop `failures`, which is right for late answers (reported here as they
  // arrive) but not for the immediate one: the composition reports those from the result.
  const immediate = 'failures' in answer ? (answer as { failures?: unknown }).failures : undefined;
  const finish = (result: OriginAnswer): T =>
    (immediate === undefined ? result : { ...result, failures: immediate }) as T;
  let current: OriginAnswer = answer;
  // Bounded: one step per late arrival, and a composition has at most this many origins.
  for (let step = 0; step < MAX_DEFERRED_STEPS; step += 1) {
    const { now, later } = splitDeferredAnswer(current);
    if (!later) return finish(now);
    let arrived: FontConfigurationFragment | undefined;
    try {
      // A host promise may ignore the signal; an export must not wait past its own deadline.
      arrived = await raceAbort(later, signal);
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      onFailure(cause);
      return finish(now);
    }
    for (const cause of lateAnswerFailures(arrived)) onFailure(cause);
    current = mergeDeferredAnswer(now, arrived) ?? now;
  }
  onFailure(new RangeError(`Font loading stopped after ${MAX_DEFERRED_STEPS} deferred steps`));
  return finish(splitDeferredAnswer(current).now);
}

/** The longest chain of late answers an export waits through before it reports and stops. */
const MAX_DEFERRED_STEPS = 256;

/** The answer re-read without the failures it already reported. */
export function withoutReportedFailures(answer: OriginAnswer): OriginAnswer {
  if (!('failures' in answer)) return answer;
  const { failures: _reported, ...rest } = answer as OriginAnswer & { failures?: unknown };
  return rest;
}

type LateAnswers = readonly (OriginAnswer | undefined)[];
type LatePromises = readonly (Promise<FontConfigurationFragment | undefined> | undefined)[];

/**
 * The whole composition again as soon as ONE origin's late faces settle, merged into its own
 * position. Origins still loading keep their promise, so the answer carries `deferred` again
 * for them: a small late face never waits for a large one. An arrival with nothing in it
 * causes no composition. Never rejects: a failed late answer is reported and its origin keeps
 * its immediate faces; a cancelled one settles to `undefined`.
 */
export async function composeLateOrigins(
  answered: LateAnswers,
  late: LatePromises,
  signal: AbortSignal | undefined,
  host: {
    readonly compose: (merged: LateAnswers) => Promise<FontConfigurationFragment | undefined>;
    readonly report: (originIndex: number, cause: unknown) => void;
  }
): Promise<FontConfigurationFragment | undefined> {
  const racing = late.flatMap((pending, originIndex) =>
    pending
      ? [
          // Settled without reporting: only the origin that wins the race reports, so a
          // promise that stays pending into the next round is never reported twice.
          pending.then(
            (value) => ({ originIndex, ok: true as const, value: value ?? undefined }),
            (cause: unknown) => ({ originIndex, ok: false as const, cause })
          ),
        ]
      : []
  );
  if (racing.length === 0) return undefined;
  // A host promise may ignore the signal: a cancelled load stops waiting at once.
  const first = await raceAbort(Promise.race(racing), signal).catch(() => undefined);
  if (!first || signal?.aborted) return undefined;
  if (first.ok) {
    for (const cause of lateAnswerFailures(first.value)) host.report(first.originIndex, cause);
  } else host.report(first.originIndex, first.cause);
  if (!first.ok || !lateAnswerHasFaces(first.value)) {
    const rest = late.map((pending, index) => (index === first.originIndex ? undefined : pending));
    return composeLateOrigins(answered, rest, signal, host);
  }
  // Index by index, not `.map`: an origin that answered only late leaves a hole in `answered`.
  const merged: (OriginAnswer | undefined)[] = [];
  for (let index = 0; index < Math.max(answered.length, late.length); index += 1) {
    const now = answered[index];
    const pending = late[index];
    merged.push(
      index === first.originIndex
        ? mergeDeferredAnswer(now, first.value)
        : pending
          ? { ...(now ?? { sources: [] }), deferred: pending }
          : now
    );
  }
  try {
    return markCompleteAnswer(await host.compose(merged));
  } catch (cause) {
    if (!signal?.aborted) host.report(first.originIndex, cause);
    return undefined;
  }
}
