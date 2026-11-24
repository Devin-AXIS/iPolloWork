/** Live host configuration for the editor facade. */

import { resolveLocale } from '../store/store/text-form-date-locale.ts';

import {
  createT,
  deepMerge,
  en,
  locales,
  type LocaleCode,
  type LocaleStrings,
} from '@docx-editor.dev/i18n';
import {
  DEFAULT_DRAWING_PAINT_STRINGS,
  drawingPaintStringsCacheToken,
  drawingPaintStringsFromTranslate,
  type DrawingPaintStrings,
} from '../output/semantic-paint-drawings.ts';
import {
  resolveOpeningEditingMode,
  type OpeningModeDecision,
  type OpeningModeGuards,
} from './opening-editing-mode.ts';

export type HostEditingMode = 'edit' | 'view' | 'suggesting';
export type EditorTranslate = (key: string, params?: Record<string, string | number>) => string;
export interface TocLabels {
  readonly title: string;
}

function localeState(value: string | undefined): { locale: string; labels: TocLabels } {
  const locale = resolveLocale(value);
  // Keep the full regional tag for input, while catalogues fall back by language.
  // Strip Unicode extensions before looking up translated labels.
  let candidate = new Intl.Locale(locale).baseName;
  while (candidate && !Object.hasOwn(locales, candidate)) {
    const separator = candidate.lastIndexOf('-');
    candidate = separator < 0 ? '' : candidate.slice(0, separator);
  }
  // Some catalogues are named by region only (pt-BR, zh-CN). Fall back to a
  // compatible language/script without mapping Traditional Chinese to Simplified.
  const requested = new Intl.Locale(locale).maximize();
  const languageMatch = candidate
    ? undefined
    : Object.keys(locales).find((name) => {
        const available = new Intl.Locale(name).maximize();
        return available.language === requested.language && available.script === requested.script;
      });
  const code = (candidate || languageMatch || 'en') as LocaleCode;
  const t = createT(
    deepMerge(en, code === 'en' ? undefined : locales[code]) as LocaleStrings,
    code
  );
  return { locale, labels: { title: t('toolbar.tableOfContents') } };
}

/** State that construction config and later instance setters share. */
export interface DocxEditorHostConfigState {
  mode(): HostEditingMode | undefined;
  modeForGate(): HostEditingMode;
  openingModeDecision(guards: OpeningModeGuards): OpeningModeDecision;
  setMode(mode: HostEditingMode | undefined): boolean;
  translate(): EditorTranslate | undefined;
  drawingStrings(): DrawingPaintStrings;
  setTranslate(translate: EditorTranslate | undefined): DrawingPaintStrings | null;
  locale(): string;
  tocLabels(): TocLabels;
  setLocale(locale: string | undefined): TocLabels | null;
}

/** Create mutable host state while module registration stays construction-only. */
export function createDocxEditorHostConfigState(initial: {
  readonly mode?: HostEditingMode;
  readonly translate?: EditorTranslate;
  readonly locale?: string;
}): DocxEditorHostConfigState {
  let mode = initial.mode;
  let translate = initial.translate;
  let drawingStrings = translate
    ? drawingPaintStringsFromTranslate(translate)
    : DEFAULT_DRAWING_PAINT_STRINGS;
  let locale = localeState(initial.locale);

  return {
    mode: () => mode,
    modeForGate: () => mode ?? 'edit',
    openingModeDecision: (guards) => resolveOpeningEditingMode(mode, guards),
    setMode(next) {
      if (mode === next) return false;
      mode = next;
      return true;
    },
    translate: () => translate,
    drawingStrings: () => drawingStrings,
    setTranslate(next) {
      if (translate === next) return null;
      translate = next;
      const nextDrawingStrings = next
        ? drawingPaintStringsFromTranslate(next)
        : DEFAULT_DRAWING_PAINT_STRINGS;
      if (
        drawingPaintStringsCacheToken(drawingStrings) ===
        drawingPaintStringsCacheToken(nextDrawingStrings)
      ) {
        drawingStrings = nextDrawingStrings;
        return null;
      }
      drawingStrings = nextDrawingStrings;
      return drawingStrings;
    },
    locale: () => locale.locale,
    tocLabels: () => locale.labels,
    setLocale(next) {
      const resolved = localeState(next);
      if (locale.locale === resolved.locale) return null;
      locale = resolved;
      return locale.labels;
    },
  };
}

/** Live host preferences update the mounted surface and survive subsequent loads. */
export function liveHostConfigSetters(
  state: DocxEditorHostConfigState,
  host: {
    surface(): {
      setTranslate(translate: EditorTranslate | undefined): void;
      setDrawingStrings(strings: DrawingPaintStrings): void;
      setTocLabels(labels: TocLabels): void;
      setLocale(locale: string): void;
    } | null;
    bump(): void;
    emitSelectionChange(): void;
  }
) {
  return {
    setTranslate(next: EditorTranslate | undefined) {
      const strings = state.setTranslate(next);
      host.surface()?.setTranslate(state.translate());
      if (strings === null) return;
      host.surface()?.setDrawingStrings(strings);
      host.bump();
      host.emitSelectionChange();
    },
    setLocale(next: string | undefined) {
      const labels = state.setLocale(next);
      if (labels === null) return;
      host.surface()?.setLocale(state.locale());
      host.surface()?.setTocLabels(labels);
      host.bump();
      host.emitSelectionChange();
    },
  };
}
