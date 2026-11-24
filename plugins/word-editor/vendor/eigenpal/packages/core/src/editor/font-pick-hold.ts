// A family a user picks may have no face yet: an on-demand resolver loads it after the pick.
// Until it arrives, the picked text keeps measuring and painting in the face it had, so it
// changes once, to the picked face, and never shows a fallback face in between. The document
// names the picked family at once; only this editor's rendering waits.

const fold = (family: string): string => family.trim().toLowerCase();

/** What a pick reads from the editor at the moment of the pick. */
export interface PickState {
  /** An on-demand resolver loads fonts as text needs them. */
  readonly dynamic: () => boolean;
  /** The editor measures text with shaped faces. */
  readonly shaping: () => boolean;
  /** The family has a face: installed, or served under another name. */
  readonly covered: (family: string) => boolean;
  /** The families the resolver serves, from its last answer. */
  readonly served: () => readonly string[] | undefined;
  /** The resolver was asked for the family before. */
  readonly asked: (family: string) => boolean;
  /** The families that the next request asks for, such as the families the document uses. */
  readonly requested: () => readonly string[];
}

/** Families that render in the face they had before a pick, until their own face installs. */
export interface FontPickHold {
  /** The family `family` renders in while it is held, or undefined. */
  readonly family: (family: string) => string | undefined;
  /**
   * A pick of `family` for text in `previous`: hold it when {@link holdsPickedFamily} says so.
   * A family that is already held keeps its hold.
   */
  readonly pick: (family: unknown, previous: string | null | undefined) => void;
  /** Release every held family that `covered` says has its own face now. */
  readonly release: (covered: (family: string) => boolean) => void;
  /**
   * Whether `family` still loads: an on-demand resolver will ask for it but was not asked yet,
   * such as just after a pick, before its request starts. A loading family is not substituted.
   * A family the resolver is never asked for, such as one over the family cap, is not loading.
   */
  readonly loading: (family: string) => boolean;
  /** Release every hold, for a new document. */
  readonly clear: () => void;
  /** A paint alias that draws a held family with the face of the family it is held in. */
  readonly alias: (
    base: ((family: string) => string | undefined) | undefined
  ) => (family: string) => string | undefined;
}

export function createFontPickHold(state: PickState): FontPickHold {
  const held = new Map<string, string>();
  const family = (name: string): string | undefined =>
    held.size === 0 ? undefined : held.get(fold(name));
  return {
    family,
    pick: (name, previous) => {
      if (!previous || !holdsPickedFamily(name, previous, state)) return;
      const key = fold(name);
      if (key !== fold(previous) && !held.has(key)) held.set(key, previous);
    },
    release: (covered) => {
      for (const key of held.keys()) if (covered(key)) held.delete(key);
    },
    loading: (name) =>
      state.dynamic() &&
      !state.asked(name) &&
      state.requested().some((requested) => fold(requested) === fold(name)),
    clear: () => held.clear(),
    alias: (base) => (name) => {
      const previous = family(name);
      return previous === undefined ? base?.(name) : (base?.(previous) ?? previous);
    },
  };
}

/**
 * Whether a pick of `family` holds the picked text in `previous`. Only when the editor shapes
 * text, an on-demand resolver serves the family, the family has no face yet, the resolver was
 * not asked for it before, and `previous` has a face. A served family's face arrives and ends
 * the hold; a family the resolver does not serve is never held, so a hold cannot outlive it.
 */
export function holdsPickedFamily(
  family: unknown,
  previous: string | undefined,
  state: PickState
): family is string {
  if (typeof family !== 'string' || !family.trim() || !previous) return false;
  if (!state.dynamic() || !state.shaping()) return false;
  if (state.covered(family) || state.asked(family)) return false;
  const key = fold(family);
  return !!state.served()?.some((name) => fold(name) === key) && state.covered(previous);
}
