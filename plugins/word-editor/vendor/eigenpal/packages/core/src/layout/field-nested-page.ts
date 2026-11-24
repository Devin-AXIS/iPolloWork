// Live evaluation of an allowlisted PAGE-family field nested inside an open complex field's
// atomic cached result, or inside a `w:fldSimple` cache.
//
// Both walks skip such an inner field's cached digits and append the projected per-sheet
// value when the inner field's own `end` closes, so a `STYLEREF` wrapping `PAGE` never stamps
// the producer's saved sheet number onto every page. The tracker is LEVEL-AWARE: it records
// the nesting level whose `separate` armed it, and only that level's matching `end` appends
// and disarms. Everything at a DEEPER level while armed — begins, separates, ends, cached
// text — is part of the replaced inner result and is ignored, so a begin/end pair inside a
// tracked result cannot clear tracking mid-field and drop the digits around it. A second
// `separate` at the tracked level (malformed) is ignored the same way: the matched end still
// appends. Any level 2..MAX_FIELD_NESTING may arm when the walk offers it, so a PAGE three or
// four levels down (under an inert REF, say) still evaluates instead of losing its digits.
//
// This tracker owns only that state: which inner field is armed, at which level, and whether
// its cached result was seen and whether any of it was visible. Extracted so the walks stay a
// straight-line reading of the field machine.

import type { AllowlistedPageFieldMatch } from './field-instruction.ts';
import { projectPageFieldValue, type FieldPageContext } from './field-page-furniture.ts';

export interface NestedPageTracker {
  /** True while an armed inner live field is skipping its cached digits. */
  readonly active: boolean;
  /**
   * Feed one nested `separate` (the machine's answer plus the nesting level it was seen at,
   * BEFORE any machine advance). Arms when idle and the kind is allowlisted; ignored entirely
   * while armed — a deeper separate belongs to the replaced inner result, and a duplicate
   * separate at the tracked level (null kind) must not clear tracking (the matched end still
   * appends). Callers pass null to decline arming (no page context, phase not projectable).
   */
  onSeparate(match: AllowlistedPageFieldMatch | null, level: number): void;
  /**
   * Feed one `end` at `level` (the nesting BEFORE the machine decrements). Returns the live
   * text to append when this end closes the tracked field — possibly `''` when the inner
   * cached result existed but was entirely suppressed (the file said this field's result is
   * not shown, and a live number would resurrect it; fldSimple parity). Returns null when the
   * end is not the tracked one: a deeper end inside the replaced result is ignored and the
   * tracker stays armed; a shallower end (unbalanced input) disarms defensively.
   */
  onEnd(level: number, pageContext: FieldPageContext | undefined): string | null;
  /** Disarm and forget (outer begin, budget abort). */
  reset(): void;
  /** Record one piece of the inner field's cached result, visible or not. */
  noteResult(visible: boolean): void;
}

export function createNestedPageTracker(): NestedPageTracker {
  let field: AllowlistedPageFieldMatch | null = null;
  let level = 0;
  let seen = false;
  let visible = false;
  const reset = (): void => {
    field = null;
    level = 0;
    seen = false;
    visible = false;
  };
  return {
    get active(): boolean {
      return field !== null;
    },
    onSeparate(next: AllowlistedPageFieldMatch | null, atLevel: number): void {
      if (field !== null) return;
      if (next === null) return;
      field = next;
      level = atLevel;
      seen = false;
      visible = false;
    },
    onEnd(atLevel: number, pageContext: FieldPageContext | undefined): string | null {
      if (field === null || atLevel > level) return null;
      const closesTracked = atLevel === level;
      const suppressed = seen && !visible;
      const value =
        closesTracked && pageContext && !suppressed
          ? projectPageFieldValue(field.kind, pageContext, field)
          : '';
      reset();
      return closesTracked ? value : null;
    },
    reset,
    noteResult(wasVisible: boolean): void {
      seen = true;
      if (wasVisible) visible = true;
    },
  };
}
