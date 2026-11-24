// One section's block run laid out under its geometry, with column balancing and the single
// cold retry a blocking unsupported-furniture refusal allows. Steps; see `layout-steps.ts`.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  layoutBlocksWithColumnBalanceSteps,
  type BlockLayoutResult,
} from './column-balance-layout.ts';
import { framedTokenJoin } from './framed-token.ts';
import { refusalYieldsHiddenFurniture } from './furniture-drawing-exclusion.ts';
import { createLayoutSession, replaceLayoutSession } from './layout-session.ts';
import type { LayoutSteps } from './layout-steps.ts';
import type { BlockLayoutOptions } from './semantic-layout.ts';

/** `pass` over `bodies`, balanced, retried once cold when unsupported furniture blocks the body. */
export function* layoutWithFurnitureRetry(
  bodies: readonly OoxmlElement[],
  revision: number,
  options: BlockLayoutOptions,
  pass: (
    bodies: readonly OoxmlElement[],
    revision: number,
    options: BlockLayoutOptions
  ) => LayoutSteps<BlockLayoutResult>
): LayoutSteps<BlockLayoutResult> {
  try {
    return yield* layoutBlocksWithColumnBalanceSteps(bodies, revision, options, pass);
  } catch (error) {
    // One cold retry without blocking unsupported furniture zones; see `refusalYieldsHiddenFurniture`.
    if (!refusalYieldsHiddenFurniture(error, options)) throw error;
    const coldSession = options.session ? createLayoutSession() : undefined;
    const result = yield* layoutBlocksWithColumnBalanceSteps(
      bodies,
      revision,
      {
        ...options,
        session: coldSession,
        producer: framedTokenJoin([options.producer ?? '', 'hidden-furniture-yields']),
        yieldHiddenFurnitureZones: true,
      },
      pass
    );
    if (options.session && coldSession) replaceLayoutSession(options.session, coldSession);
    return result;
  }
}
