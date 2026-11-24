// The exclusion zones a body page inherits from outside the current pass: the previous pass's
// drawing zones for that page, plus the host sheet's zones on a continued section's first page,
// or else the zones of header and footer tables.

import type { ExclusionZone } from './drawing-exclusion.ts';

export interface PreviousPassZoneSources {
  readonly byPage?: ReadonlyMap<number, readonly ExclusionZone[]>;
  /** The host sheet's zones when this section continues on it (page 0 only). */
  readonly hostZones?: readonly ExclusionZone[];
  /** Header and footer zones hold tables, so pages without host zones add them. */
  readonly furnitureHoldsTables: boolean;
  readonly furnitureZones: (index: number) => readonly ExclusionZone[];
}

const NO_ZONES: readonly ExclusionZone[] = Object.freeze([]);

/** A getter for page `index`'s zones that recomputes only when the page changes. */
export function createPreviousPassZones(
  sources: PreviousPassZoneSources
): (index: number) => readonly ExclusionZone[] {
  let cachedIndex = -1;
  let cached = NO_ZONES;
  return (index) => {
    if (cachedIndex === index) return cached;
    const bodyZones = sources.byPage?.get(index) ?? NO_ZONES;
    cachedIndex = index;
    cached = bodyZones;
    const hostZones = index === 0 ? sources.hostZones : undefined;
    if (hostZones) {
      if (hostZones.length) cached = Object.freeze([...bodyZones, ...hostZones]);
    } else if (sources.furnitureHoldsTables) {
      const zones = sources.furnitureZones(index);
      if (zones.length) cached = Object.freeze([...bodyZones, ...zones]);
    }
    return cached;
  };
}
