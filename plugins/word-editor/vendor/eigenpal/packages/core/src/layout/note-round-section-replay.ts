// Reusing a section's result between the rounds of one footnote reserve walk.
//
// Every round of the walk lays the document out from its first section, and a section before
// the page being decided gets the same inputs on each round: the same blocks, the same flow
// state from the sections before it, and the same reserves on its pages. Its own session then
// finds nothing to place, but the check still walks its blocks and pages. With one round per
// note page, that check ran for each earlier section on every round. A section whose inputs
// are equal to those of its last round takes that round's result instead.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { LayoutSession } from './layout-session.ts';
import { framedTokenJoin } from './layout-cache.ts';

interface SectionReplay<Result> {
  /** The walk the result belongs to; see `SemanticLayoutOptions.noteRoundContext`. */
  readonly round: object;
  readonly blocks: readonly OoxmlElement[];
  /** Everything else the section was laid out from, other than its reserves. */
  readonly entry: string;
  readonly pageIndexStart: number;
  readonly pageCount: number;
  /** The reserves on the section's pages, and on the page after its last one. */
  readonly reserves: string;
  readonly result: Result;
}

const replays = new WeakMap<LayoutSession, SectionReplay<unknown>>();

/** The reserves a section with `pageCount` pages from `pageIndexStart` can read. */
function reservesKey(
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  pageCount: number
): string {
  let key = '';
  for (let index = pageIndexStart; index <= pageIndexStart + pageCount; index += 1) {
    const height = reserves?.get(index) ?? 0;
    if (height > 0) key += `${index - pageIndexStart}:${height};`;
  }
  return key;
}

function sameBlocks(a: readonly OoxmlElement[], b: readonly OoxmlElement[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** What a section's round is laid out from. */
export interface SectionRoundInputs {
  readonly session: LayoutSession;
  readonly round: object;
  readonly blocks: readonly OoxmlElement[];
  readonly entry: string;
  readonly pageIndexStart: number;
  readonly reserves: ReadonlyMap<number, number> | undefined;
}

/**
 * The inputs of a section's round, when its result can be kept for the next round: a round
 * of a walk that sweeps no cache, takes no seed from the previous pass, and starts the section
 * on a sheet of its own. Undefined otherwise. `entry` lists the rest of what the section is
 * laid out from: its structure key and furniture, and the flow state the sections before it
 * leave.
 */
export function sectionRoundInputs(
  options: {
    readonly noteRoundContext?: object;
    readonly pageBottomReserves?: ReadonlyMap<number, number>;
    readonly pageBottomReservesFromPreviousPass?: boolean;
    readonly pageBottomReservesFollowFlow?: boolean;
  },
  retainKeys: unknown,
  continues: boolean,
  session: LayoutSession | undefined,
  section: {
    readonly blocks: readonly OoxmlElement[];
    readonly pageIndexStart: number;
    readonly entry: readonly unknown[];
  }
): SectionRoundInputs | undefined {
  const round = options.noteRoundContext;
  if (
    !round ||
    !session ||
    retainKeys !== false ||
    continues ||
    options.pageBottomReservesFromPreviousPass ||
    options.pageBottomReservesFollowFlow
  ) {
    return undefined;
  }
  return {
    session,
    round,
    blocks: section.blocks,
    entry: framedTokenJoin(section.entry.map(String)),
    pageIndexStart: section.pageIndexStart,
    reserves: options.pageBottomReserves,
  };
}

/**
 * The result the session gave for equal inputs in an earlier round of the same walk. The
 * session's stats then read as a pass that placed nothing and kept every page.
 */
export function replayedSectionRound<Result extends { readonly pages: readonly unknown[] }>(
  inputs: SectionRoundInputs
): Result | undefined {
  const replay = replays.get(inputs.session) as SectionReplay<Result> | undefined;
  if (
    !replay ||
    replay.round !== inputs.round ||
    replay.entry !== inputs.entry ||
    replay.pageIndexStart !== inputs.pageIndexStart ||
    !sameBlocks(replay.blocks, inputs.blocks) ||
    replay.reserves !== reservesKey(inputs.reserves, inputs.pageIndexStart, replay.pageCount)
  ) {
    return undefined;
  }
  const { session } = inputs;
  session.stats = { ...session.stats, placed: 0, reusedPages: replay.result.pages.length };
  return replay.result;
}

/** Keep the result of a section's round for the next round of the same walk. */
export function rememberSectionRound<Result extends { readonly pages: readonly unknown[] }>(
  inputs: SectionRoundInputs,
  result: Result
): void {
  const pageCount = result.pages.length;
  replays.set(inputs.session, {
    round: inputs.round,
    blocks: inputs.blocks,
    entry: inputs.entry,
    pageIndexStart: inputs.pageIndexStart,
    pageCount,
    reserves: reservesKey(inputs.reserves, inputs.pageIndexStart, pageCount),
    result,
  });
}
