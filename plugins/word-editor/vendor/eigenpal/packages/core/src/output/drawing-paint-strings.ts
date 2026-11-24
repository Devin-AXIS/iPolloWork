// Localized labels a painted drawing shows when it cannot show its picture: a resource that is
// missing, external, invalid or still loading, or a graphic that is not a picture and has no
// renderer, which paints as a labeled placeholder of its `DrawingPlaceholderKind`.

import type { DrawingPlaceholderKind } from '../layout/drawing-paint-fields.ts';

/** Localized refusal labels; adapters supply i18n-backed implementations. */
export interface DrawingPaintStrings {
  readonly unsupportedFormat: (format: string) => string;
  /**
   * The whole label of a placeholder for a graphic that is not a picture. `kind` is a
   * `DrawingPlaceholderKind` (`chart`, `diagram`, `shape`, `group`, `textbox`, `canvas` or
   * `graphic`); the label names that kind, so a chart reads as a chart that is not shown.
   */
  readonly nonPictureGraphic: (kind: string) => string;
  readonly missingResource: string;
  readonly externalResource: string;
  readonly invalidResource: string;
  readonly contentMismatch: string;
  readonly decodeFailed: string;
  readonly resourceLimit: string;
  readonly pendingResource: string;
}

const PLACEHOLDER_KINDS: readonly DrawingPlaceholderKind[] = [
  'chart',
  'diagram',
  'shape',
  'group',
  'textbox',
  'canvas',
  'graphic',
];

/** English placeholder labels. A Map, so an unknown kind answers undefined. */
const DEFAULT_PLACEHOLDER_LABELS: ReadonlyMap<string, string> = new Map<
  DrawingPlaceholderKind,
  string
>([
  ['chart', 'Chart not shown'],
  ['diagram', 'Unsupported diagram'],
  ['shape', 'Unsupported shape'],
  ['group', 'Unsupported shape group'],
  ['textbox', 'Unsupported text box'],
  ['canvas', 'Unsupported drawing canvas'],
  ['graphic', 'Unsupported graphic'],
]);

function placeholderKindOf(kind: string): DrawingPlaceholderKind {
  return (PLACEHOLDER_KINDS as readonly string[]).includes(kind)
    ? (kind as DrawingPlaceholderKind)
    : 'graphic';
}

export function drawingPaintStringsCacheToken(strings: DrawingPaintStrings): string {
  return [
    strings.missingResource,
    strings.externalResource,
    strings.invalidResource,
    strings.contentMismatch,
    strings.decodeFailed,
    strings.resourceLimit,
    strings.pendingResource,
    strings.unsupportedFormat('probe'),
    ...PLACEHOLDER_KINDS.map((kind) => strings.nonPictureGraphic(kind)),
  ].join('\0');
}

export const DEFAULT_DRAWING_PAINT_STRINGS: DrawingPaintStrings = Object.freeze({
  unsupportedFormat: (format: string) => `Unsupported image format (${format})`,
  nonPictureGraphic: (kind: string) => DEFAULT_PLACEHOLDER_LABELS.get(placeholderKindOf(kind))!,
  missingResource: 'Image missing',
  externalResource: 'External image not loaded',
  invalidResource: 'Invalid image',
  contentMismatch: 'Image content does not match its type',
  decodeFailed: 'Image could not be decoded',
  resourceLimit: 'Image exceeds size limits',
  pendingResource: 'Loading image',
});

/** Build localized refusal strings from an i18n `t('image.*')` callback. */
export function drawingPaintStringsFromTranslate(
  t: (key: string, params?: Record<string, string | number>) => string
): DrawingPaintStrings {
  return Object.freeze({
    unsupportedFormat: (format: string) => t('image.unsupportedFormat', { format }),
    nonPictureGraphic: (kind: string) => t(`image.placeholder.${placeholderKindOf(kind)}`),
    missingResource: t('image.missingResource'),
    externalResource: t('image.externalResource'),
    invalidResource: t('image.invalidResource'),
    contentMismatch: t('image.contentMismatch'),
    decodeFailed: t('image.decodeFailed'),
    resourceLimit: t('image.resourceLimit'),
    pendingResource: t('image.pendingResource'),
  });
}
