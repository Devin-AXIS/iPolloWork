import { parseCharacterStyleField, type CharacterStyleField } from './field-character-style.ts';
// FORMCHECKBOX / FORMDROPDOWN legacy form fields (§17.16.5.22, §17.16.5.16).
//
// Their state lives in `w:ffData` under the begin `w:fldChar`, read once at the trust boundary
// by `store/package/field-nodes.ts` (`legacyFormFieldDataOf` — state only, macros never). This
// module decides what that state paints over the field's single reserved atom unit:
//
// - FORMCHECKBOX always renders from ffData — the checked bit is the authority, so a stale
//   cached glyph never wins. ☒ (U+2612) when checked, ☐ (U+2610) when not; an explicit
//   `w:size` overrides the run's font size, `w:sizeAuto` keeps it.
// - FORMDROPDOWN prefers its cached result (what Word last painted) and synthesizes the
//   selected entry only when the file cached none at all — a cached result that exists but
//   is hidden stays hidden.
//
// Everything fails closed to the previous behavior (cached text or nothing): an instruction
// without matching ffData state, an empty entry list, an empty selected entry.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { LegacyFormFieldData } from '../store/package/field-nodes.ts';
import type { FieldAtomMarker } from './field-pieces.ts';
import { parseButtonInstruction, type ButtonFieldSpec } from './field-button.ts';
import { parseDocPropertyInstruction, type DocPropertyField } from './field-doc-property.ts';
import { normalizeFieldInstruction } from './field-instruction.ts';
import { allowlistedPageField } from './field-instruction.ts';
import { parseHyperlinkInstruction, type HyperlinkFieldSpec } from './field-link.ts';
import { parseAutonumInstruction, type AutonumFieldSpec } from './field-autonum.ts';
import { parseListNumInstruction, type ListNumFieldSpec } from './field-listnum.ts';
import { parseRefInstruction, type RefFieldSpec } from './field-ref.ts';
import { parseRefLinkInstruction } from './field-ref-link.ts';
import { refSpecModifiersOf } from './field-ref-parse.ts';
import { parseSymbolInstruction, type SymbolFieldSpec } from './field-symbol.ts';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';

/** Which legacy form field a complex-field instruction names. */
export type FormFieldKind = 'checkbox' | 'dropdown';

/** BALLOT BOX WITH X — what Word paints for a checked FORMCHECKBOX. */
export const CHECKBOX_CHECKED_GLYPH = '☒';
/** BALLOT BOX — the unchecked FORMCHECKBOX glyph. */
export const CHECKBOX_UNCHECKED_GLYPH = '☐';

/**
 * Recognize a FORMCHECKBOX / FORMDROPDOWN instruction, bounded and normalized like every
 * other allowlisted instruction. Anything else — including an overflowing instruction — is
 * null and stays inert.
 */
export function parseFormFieldInstruction(raw: string): FormFieldKind | null {
  const normalized = normalizeFieldInstruction(raw);
  if (normalized === 'FORMCHECKBOX') return 'checkbox';
  if (normalized === 'FORMDROPDOWN') return 'dropdown';
  return null;
}

/**
 * The instruction-derived specs a pending atomic field captures before the machine's buffer
 * resets. Structural rather than `PendingFieldProjection` so this module needs nothing from
 * the walk's vocabulary.
 */
export interface CapturedInstructionSpecs {
  /** ASK and SET store their result in a bookmark and display nothing where they stand. */
  hidesResult?: boolean;
  characterStyleSpec?: CharacterStyleField | null;
  symbolSpec: SymbolFieldSpec | null;
  linkSpec: HyperlinkFieldSpec | null;
  formSpec: FormFieldKind | null;
  buttonSpec: ButtonFieldSpec | null;
  docPropertySpec: DocPropertyField | null;
  refSpec: RefFieldSpec | null;
  autonumSpec: AutonumFieldSpec | null;
  /** Recognized LISTNUM instruction; its number comes from the story's list walk. */
  listNumSpec?: ListNumFieldSpec | null;
}

/**
 * Capture every instruction-derived spec at once — at the outermost `separate`, or at the
 * no-separate `end`, while the machine still holds the raw instruction. The instructions are
 * mutually exclusive, so the first recognizer that hits wins and the rest stay null.
 */
export function captureInstructionSpecs(pending: CapturedInstructionSpecs, raw: string): void {
  pending.hidesResult = /^\s*(?:ASK|SET)(?:\s|$)/i.test(raw);
  pending.characterStyleSpec = parseCharacterStyleField(raw);
  pending.symbolSpec = parseSymbolInstruction(raw);
  if (pending.symbolSpec) return;
  pending.linkSpec = parseHyperlinkInstruction(raw);
  if (pending.linkSpec) return;
  pending.formSpec = parseFormFieldInstruction(raw);
  if (pending.formSpec) return;
  pending.buttonSpec = parseButtonInstruction(raw);
  if (pending.buttonSpec) return;
  pending.docPropertySpec = parseDocPropertyInstruction(raw);
  if (pending.docPropertySpec) return;
  pending.linkSpec = parseRefLinkInstruction(raw);
  pending.refSpec = parseRefInstruction(raw);
  if (pending.refSpec) return;
  pending.autonumSpec = parseAutonumInstruction(raw);
  if (pending.autonumSpec) return;
  pending.listNumSpec = parseListNumInstruction(raw);
}

/**
 * Whether a recognized complex field can create visible text when no stored result paints.
 *
 * Font preflight and field projection share this allowlist so adding a new synthesized field to
 * Core cannot silently leave headless exporters measuring it with the fixed fallback. PAGE-family
 * fields require a separator; SYMBOL and AUTONUM are valid in Word's begin/instruction/end shape.
 * A form field additionally requires the legacy state payload that supplies its display value.
 * @internal
 */
export function complexFieldInstructionMaySynthesizeGlyph(
  raw: string,
  options: {
    readonly hasSeparate: boolean;
    readonly hasLegacyFormData: boolean;
    readonly allowPageFields: boolean;
    readonly allowRefFields: boolean;
    readonly allowPageRef: boolean;
    readonly allowAutonum: boolean;
  }
): boolean {
  if (options.allowPageFields && options.hasSeparate && allowlistedPageField(raw) !== null) {
    return true;
  }
  const specs: CapturedInstructionSpecs = {
    symbolSpec: null,
    linkSpec: null,
    formSpec: null,
    buttonSpec: null,
    docPropertySpec: null,
    refSpec: null,
    autonumSpec: null,
  };
  captureInstructionSpecs(specs, raw);
  return (
    specs.symbolSpec !== null ||
    specs.buttonSpec !== null ||
    specs.docPropertySpec !== null ||
    (options.allowRefFields &&
      specs.refSpec !== null &&
      (options.allowPageRef || !refSpecModifiersOf(specs.refSpec).pageRef)) ||
    (options.allowAutonum && (specs.autonumSpec !== null || !!specs.listNumSpec)) ||
    (specs.formSpec !== null && options.hasLegacyFormData)
  );
}

/** Recognized `w:fldSimple` instructions that may synthesize an empty stored result. @internal */
export function simpleFieldInstructionMaySynthesizeGlyph(
  raw: string,
  options: {
    readonly allowPageFields: boolean;
    readonly allowRefFields: boolean;
    readonly allowPageRef: boolean;
    readonly allowAutonum: boolean;
  }
): boolean {
  if (options.allowPageFields && allowlistedPageField(raw) !== null) return true;
  const specs: CapturedInstructionSpecs = {
    symbolSpec: null,
    linkSpec: null,
    formSpec: null,
    buttonSpec: null,
    docPropertySpec: null,
    refSpec: null,
    autonumSpec: null,
  };
  captureInstructionSpecs(specs, raw);
  return (
    specs.symbolSpec !== null ||
    specs.buttonSpec !== null ||
    specs.docPropertySpec !== null ||
    (options.allowRefFields &&
      specs.refSpec !== null &&
      (options.allowPageRef || !refSpecModifiersOf(specs.refSpec).pageRef)) ||
    (options.allowAutonum && (specs.autonumSpec !== null || !!specs.listNumSpec))
  );
}

/**
 * Interactive legacy field state and its macro-free accessible name. Paint uses the marker
 * for checkbox hit targets and native dropdowns without parsing displayed values.
 */
export function formControlMarkerOf(pending: {
  readonly formSpec: FormFieldKind | null;
  readonly formData: LegacyFormFieldData | null;
  readonly formAccessibleName?: string;
}): FieldAtomMarker['formControl'] | undefined {
  if (pending.formSpec === 'dropdown' && pending.formData?.kind === 'dropdown') {
    return {
      ...pending.formData,
      ...(pending.formAccessibleName ? { accessibleName: pending.formAccessibleName } : {}),
    };
  }
  if (pending.formSpec !== 'checkbox' || pending.formData?.kind !== 'checkbox') return undefined;
  return {
    kind: 'checkbox',
    checked: pending.formData.checked,
    ...(pending.formAccessibleName ? { accessibleName: pending.formAccessibleName } : {}),
  };
}

/** The synthesized form-field result: text plus the props/style the piece should carry. */
export interface FormFieldGlyph {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
}

/**
 * Resolve a pending form field to the text it paints, or null to fall through to the
 * existing branches (cached text or nothing).
 *
 * A checkbox synthesizes unconditionally when its ffData state is present — ffData is the
 * state authority and a stale cached glyph must not win. A dropdown defers to a non-empty
 * cached result first. A form instruction whose ffData is missing or of the wrong shape
 * fails closed.
 */
export function formFieldResult(
  pending: {
    readonly formSpec: FormFieldKind | null;
    readonly formData: LegacyFormFieldData | null;
    readonly cachedText: string;
    /** Result content this display mode keeps existed — see `PendingFieldProjection`. */
    readonly sawResultContent: boolean;
    readonly props: readonly OoxmlProperty[];
    readonly style: ResolvedRunStyle;
  },
  themeFonts?: ThemeFonts
): FormFieldGlyph | null {
  if (pending.formSpec === 'checkbox') {
    if (pending.formData?.kind !== 'checkbox') return null;
    const text = pending.formData.checked ? CHECKBOX_CHECKED_GLYPH : CHECKBOX_UNCHECKED_GLYPH;
    if (pending.formData.sizeHalfPoints === null) {
      return { text, props: pending.props, style: pending.style };
    }
    // Explicit `w:size` is half-points, same unit as `w:sz` — landed as an override on the
    // result-style chain and resolved through the ordinary cascade.
    const props: readonly OoxmlProperty[] = [
      ...pending.props,
      { localName: 'sz', attributes: { val: String(pending.formData.sizeHalfPoints) } },
    ];
    return { text, props, style: resolveRunStyle(props, themeFonts) };
  }
  if (pending.formSpec === 'dropdown') {
    // A non-empty cache falls through to paint as-is; a cache that existed but was hidden
    // suppresses synthesis too — the file said this result is not shown.
    if (pending.cachedText.length > 0 || pending.sawResultContent) return null;
    if (pending.formData?.kind !== 'dropdown') return null;
    const entry = pending.formData.entries[pending.formData.selectedIndex];
    if (entry === undefined) return null;
    // An empty declared choice still needs a hit target so the picker can be reopened.
    const text = entry || '\u00a0';
    return { text, props: pending.props, style: pending.style };
  }
  return null;
}
