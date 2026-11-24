import { paintRevisionMarkup } from './revision-markup-paint.ts';
import { formatRevisionOf } from '../layout/revision-projection.ts';
import {
  REVIEW_AUTHOR_SLOTS,
  revisionPresentationOf,
  reviewAuthorSlotColor,
} from './revision-presentation.ts';
import type { StyleSpanRecord } from '../layout/semantic-records.ts';
import type { PaintContext } from './semantic-paint.ts';

export function applyRevisionPresentation(
  element: HTMLElement,
  span: StyleSpanRecord,
  ctx: PaintContext
): void {
  // A tracked FORMAT change alters no characters, so it has no strike or underline of its own
  // to wear. It still has to be visible: the reader is looking at text whose appearance is
  // itself a pending decision. A dashed rule and a tint say "this changed" without claiming
  // the words were added or removed.
  const format = formatRevisionOf(span.props) ?? ctx.paragraphFormatRevision;
  const colors = ctx.revisionStyles;
  const presentation = revisionPresentationOf(span.revisions, colors?.authorSlots, colors?.styles);
  if (!presentation && !format) return;

  if (presentation) {
    const { attribution } = presentation;
    element.classList.add('docx-revision', `docx-revision-${attribution.kind}`);
    element.dataset.revisionKind = attribution.kind;
    element.dataset.revisionId = attribution.id;
    if (attribution.author !== '') element.dataset.reviewAuthor = attribution.author;
    if (attribution.date !== undefined) element.dataset.revisionDate = attribution.date;
    // The author's ramp slot, as a CSS hook: `[data-review-author-slot='2']` restyles one
    // reviewer's changes without the host knowing the name. Only under author colouring,
    // because the slot map is in the paint-reuse key only then — emitted always, a new
    // author appearing would have to repaint every page in every scheme.
    const authorStyle = colors?.styles.get(attribution.author);
    if (colors) {
      element.dataset.reviewAuthorSlot = String(
        (colors.authorSlots.get(attribution.author) ?? 0) % REVIEW_AUTHOR_SLOTS
      );
      // Host classes for this author's changes, for whatever the typed fields do not
      // cover. Pre-split when the context resolved, so paint adds tokens rather than
      // running a regex for every painted span.
      const tokens = colors.classTokens.get(attribution.author);
      if (tokens) for (let i = 0; i < tokens.length; i += 1) element.classList.add(tokens[i]!);
    }
    // SELECTIVE, and only where the host actually asked for a COLOUR. A declaration that
    // names only an avatar or a class says nothing about ink, so the ink stays on the kind
    // colours: "give this reviewer a picture" must not silently recolour their text.
    // An unstyled author takes whatever the scheme says for `others` — the ramp under
    // by-author colouring, the kind colours otherwise, so "highlight one reviewer, keep the
    // rest green/red" is expressible.
    //
    // Under author colouring the KIND still reads from the decoration — underline for an
    // insertion, strike for a deletion — while the colour answers "whose", exactly Word's
    // by-author view. The strike/underline rules above are untouched by the scheme.
    const byAuthor =
      colors !== undefined && (authorStyle?.color !== undefined || colors.others === 'author');
    const color = byAuthor ? presentation.authorColor : presentation.color;
    if (ctx.revisionMarkup) {
      if (authorStyle?.background) element.style.backgroundColor = authorStyle.background;
      paintRevisionMarkup(
        element,
        ctx.revisionMarkup,
        presentation.deleted
          ? (span.revisions?.find((item) => item.kind === 'delete' || item.kind === 'moveFrom')
              ?.kind ?? attribution.kind)
          : attribution.kind,
        presentation.authorColor,
        ctx.revisionKindColors || colors?.others === 'kind' || authorStyle?.color
          ? color
          : undefined,
        authorStyle?.background
      );
      return;
    }
    element.style.color = color;
    // The TINT is what makes a change findable when scanning rather than reading. A decoration
    // alone is a hairline: on a dense page of small type it disappears, and a reviewer skims
    // straight past an edit.
    //
    // The WASH, not the full tint. This layer covers every tracked change in the document; the
    // band layer covers only the open one and adds the full tint over this. Painting both at
    // full strength gave pending and open changes the same weight — the pale/open distinction
    // the band exists to draw never appeared, because this was already at the band's colour.
    //
    // The wash keeps the KIND pair under either scheme — unless the host's style for this
    // author says otherwise. At its faint strength an author-mixed wash is
    // indistinguishable anyway, and the kind pair keeps "added" and "removed" scannable
    // while the ink answers "whose". It also avoids per-run `color-mix()` for host colours.
    element.style.backgroundColor =
      authorStyle?.background ??
      (presentation.deleted
        ? 'var(--doc-revision-deletion-wash)'
        : 'var(--doc-revision-insertion-wash)');
    if (presentation.line) {
      element.style.textDecorationLine = presentation.line;
      if (attribution.kind === 'insert' && presentation.line === 'underline') {
        element.style.textDecorationStyle = 'var(--doc-revision-insertion-decoration-style)';
        element.style.textDecorationThickness =
          'var(--doc-revision-insertion-decoration-thickness)';
        element.style.textUnderlineOffset = 'var(--doc-revision-insertion-underline-offset)';
      } else {
        element.style.textDecorationStyle = presentation.decorationStyle;
      }
      element.style.textDecorationColor = color;
    }
    return;
  }

  // A tracked FORMAT change gets its provenance and NO inline decoration — its marking
  // (a grey wash and a faint dotted rule) comes from the STYLESHEET's
  // `.docx-revision-format`, not from style written here. The split is deliberate: an
  // authored underline or strike is painted as inline style and so outranks the stylesheet,
  // keeping the author's own decoration intact, and a host that finds even the quiet grey
  // too loud at its documents' density (a real fixture carries 18,284 of these) can silence
  // it with one CSS override instead of forking the painter.
  element.classList.add('docx-revision', ...(ctx.revisionMarkup ? [] : ['docx-revision-format']));
  element.dataset.revisionKind = 'format';
  element.dataset.formattingKind = formatRevisionOf(span.props) ? 'rPrChange' : 'pPrChange';
  element.dataset.revisionId = format!.id;
  if (format!.author !== '') element.dataset.reviewAuthor = format!.author;
  if (format!.date !== undefined) element.dataset.revisionDate = format!.date;
  // A format revision has an AUTHOR like any other, so the per-author hooks belong here
  // too — a host rule scoped to a reviewer's slot or class would otherwise skip what can be
  // the largest population of tracked changes in a document. The ink stays the stylesheet's
  // grey unless the host named a colour: a format change is not an addition or a removal,
  // and painting it in the author's ink would claim it was.
  if (colors) {
    const formatStyle = colors.styles.get(format!.author);
    element.dataset.reviewAuthorSlot = String(
      (colors.authorSlots.get(format!.author) ?? 0) % REVIEW_AUTHOR_SLOTS
    );
    const tokens = colors.classTokens.get(format!.author);
    if (tokens) for (let i = 0; i < tokens.length; i += 1) element.classList.add(tokens[i]!);
    if (!ctx.revisionMarkup && formatStyle?.color !== undefined)
      element.style.color = formatStyle.color;
    // The wash too, as the span branch applies it. Declaring `background` for an author and
    // seeing it on their insertions but not on their property changes is not a rule anyone
    // could infer.
    if (formatStyle?.background !== undefined) {
      element.style.backgroundColor = formatStyle.background;
    }
  }
  if (ctx.revisionMarkup)
    paintRevisionMarkup(
      element,
      ctx.revisionMarkup,
      'format',
      colors?.styles.get(format!.author)?.color ??
        reviewAuthorSlotColor(colors?.authorSlots.get(format!.author) ?? 0),
      undefined,
      colors?.styles.get(format!.author)?.background
    );
}
