import { paragraphTextOf, type ReviewRevisionItem } from '../store/index.ts';
import { allParagraphs } from '../binding/tree-binding.ts';
import { paragraphFragmentsOf } from '../layout/semantic-record-queries.ts';
import { isValidParaId } from '../store/package/para-id.ts';
import type {
  RefreshChange,
  RefreshChangeInput,
  RefreshLocation,
} from './document-refresh-types.ts';
import type { RefreshHost } from './document-refresh-host.ts';

export interface LocatedChange {
  change: RefreshChange;
  fingerprint: string;
  paragraphId?: string;
  offset?: number;
}
function revisionFingerprint(item: ReviewRevisionItem): string {
  return JSON.stringify([item.revisionKind, item.author, item.date, item.text, item.replacedText]);
}
export function revisionChangeKeys(host: RefreshHost): Map<string, string> {
  return new Map(
    host
      .surface()
      ?.session.reviewItems()
      .filter((item) => item.kind === 'revision')
      .map((item) => [item.id, revisionFingerprint(item)])
  );
}
export function resolveRefreshChanges(
  host: RefreshHost,
  resultId: string,
  inputs: readonly RefreshChangeInput[] | undefined,
  seen: ReadonlyMap<string, string>
): { located: LocatedChange[]; available: boolean } {
  const surface = host.surface();
  if (!surface) return { located: [], available: false };
  const part = surface.session.part();
  const paragraphs = allParagraphs(part);
  const anchors = surface.session.paragraphAnchors().paraIdByNode;
  const byAnchor = new Map<string, (typeof paragraphs)[number] | null>();
  const indices = new Map<string, number>();
  paragraphs.forEach((paragraph, index) => {
    indices.set(paragraph.id, index);
    const anchor = anchors.get(paragraph.id);
    if (anchor) {
      const key = anchor.toUpperCase();
      byAnchor.set(key, byAnchor.has(key) ? null : paragraph);
    }
  });
  const placedIds = new Set(
    surface.layout().pages.flatMap((page) => paragraphFragmentsOf(page).map((p) => p.paragraphId))
  );
  const resolve = (
    input: RefreshChangeInput,
    fingerprint = JSON.stringify([
      typeof input.location?.text === 'string' ? input.location.text : null,
      input.unavailableReason,
      input.description,
    ])
  ): LocatedChange => {
    const base = {
      id: input.id,
      resultId,
      isNew: seen.get(input.id) !== fingerprint,
      ...(input.description !== undefined ? { description: input.description } : {}),
    };
    if (!input.location)
      return {
        fingerprint,
        change: {
          ...base,
          status: input.unavailableReason ?? 'unavailable',
          diagnostic: Object.freeze({
            code: input.unavailableReason === 'deleted' ? 'deleted' : 'missing-location',
          }),
        },
      };
    const location = input.location;
    const invalid = (code: NonNullable<RefreshChange['diagnostic']>['code']): LocatedChange => ({
      fingerprint,
      change: {
        ...base,
        status: 'invalid',
        diagnostic: Object.freeze({ code, location: Object.freeze({ ...location }) }),
      },
    });
    if (
      (location.paragraphId === undefined) === (location.paragraphIndex === undefined) ||
      (location.paragraphIndex !== undefined &&
        (!Number.isSafeInteger(location.paragraphIndex) || location.paragraphIndex < 0))
    )
      return invalid('invalid-selector');
    if (
      location.paragraphId !== undefined &&
      (typeof location.paragraphId !== 'string' || !isValidParaId(location.paragraphId))
    )
      return invalid('invalid-paragraph-id');
    const paragraph =
      location.paragraphId !== undefined
        ? byAnchor.get(location.paragraphId.toUpperCase())
        : paragraphs[location.paragraphIndex!];
    if (paragraph === null) return invalid('ambiguous-paragraph-id');
    if (!paragraph) return invalid('paragraph-not-found');
    const text = paragraph ? (paragraphTextOf(part, paragraph.id) ?? '') : '';
    if (
      !Number.isSafeInteger(location.start) ||
      !Number.isSafeInteger(location.end) ||
      location.start < 0 ||
      location.end <= location.start ||
      location.end > text.length
    )
      return invalid('invalid-offsets');
    if (text.slice(location.start, location.end) !== location.text) return invalid('text-mismatch');
    const placed = placedIds.has(paragraph.id);
    return {
      fingerprint,
      change: {
        ...base,
        status: placed ? 'available' : 'unavailable',
        location: Object.freeze({ ...location }),
        ...(!placed
          ? {
              diagnostic: Object.freeze({
                code: 'not-rendered' as const,
                location: Object.freeze({ ...location }),
              }),
            }
          : {}),
      },
      ...(placed ? { paragraphId: paragraph.id, offset: location.start } : {}),
    };
  };
  if (inputs) return { located: inputs.map((input) => resolve(input)), available: true };
  const revisions = surface.session.reviewItems().filter((item) => item.kind === 'revision');
  const located = revisions.map((item): LocatedChange => {
    const fingerprint = revisionFingerprint(item);
    const range = item.ranges[0];
    if (!range || range.partName !== part.name)
      return {
        fingerprint,
        change: {
          id: item.id,
          resultId,
          isNew: seen.get(item.id) !== fingerprint,
          status: range ? 'unsupported-story' : 'unavailable',
          diagnostic: Object.freeze({ code: range ? 'unsupported-story' : 'missing-location' }),
        },
      };
    const index = indices.get(range.start.paragraphId) ?? -1;
    if (item.revisionKind === 'delete' || item.revisionKind === 'moveFrom') {
      return {
        fingerprint,
        change: {
          id: item.id,
          resultId,
          isNew: seen.get(item.id) !== fingerprint,
          status: 'deleted',
          diagnostic: Object.freeze({ code: 'deleted' }),
        },
      };
    }
    // Only an exact single-paragraph range can name a temporary highlight.
    if (range.start.paragraphId !== range.end.paragraphId)
      return {
        fingerprint,
        change: {
          id: item.id,
          resultId,
          isNew: seen.get(item.id) !== fingerprint,
          status: 'unavailable',
          diagnostic: Object.freeze({ code: 'multiple-paragraphs' }),
        },
      };
    const text = paragraphTextOf(part, range.start.paragraphId) ?? '';
    const location: RefreshLocation = {
      paragraphIndex: index,
      start: range.start.offset,
      end: range.end.offset,
      text: text.slice(range.start.offset, range.end.offset),
    };
    return resolve({ id: item.id, location }, fingerprint);
  });
  return { located, available: revisions.length > 0 };
}
