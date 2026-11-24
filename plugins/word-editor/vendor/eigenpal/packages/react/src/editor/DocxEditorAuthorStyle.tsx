// Declarative revision styling: JSX declares who draws in what, and the engine follows.
//
// The painted document is engine-rendered DOM — no host component renders inside it — so
// per-author styling cannot be declared where a review card renders (a card exists per
// review item, only under a mounted rail, and only after the page painted). It CAN be
// declared as ordinary render-nothing components under the Root: mounting one applies it,
// changing a prop re-applies it, unmounting restores what was left. Both compose with
// `useReviewAuthors` (the roster) and `useReviewAuthor` (inside custom cards).
//
// The DEFAULT needs no component at all: the engine colours by author, as Word does.

import { useContext, useEffect, useRef } from 'react';
import type { RevisionAuthorStyle } from '@docx-editor.dev/core/editor';
import { RevisionStyleRegistryContext } from './revision-style-registry';

function useDeclarationId(): symbol {
  const ref = useRef<symbol | null>(null);
  if (ref.current === null) ref.current = Symbol('revision-style-declaration');
  return ref.current;
}

/**
 * Colour tracked changes by the TYPE of change instead of by author, while mounted.
 *
 * The editor colours by author out of the box — Word's own default, so a paragraph three
 * people edited reads as three people. Mount this to opt out: insertions take
 * `--doc-revision-insertion` and deletions `--doc-revision-deletion`, whoever proposed
 * them. Renders nothing; unmounting it returns to by-author colouring.
 *
 * Composed with `DocxEditor.AuthorStyle`, it also expresses "highlight these reviewers and
 * leave everyone else green and red": the authors you declare keep their own colour, and
 * this puts the rest on the kind colours.
 *
 * ```tsx
 * <DocxEditor.Root document={bytes} modules={MODULES}>
 *   <DocxEditor.ColorByChangeType />
 *   …
 * </DocxEditor.Root>
 * ```
 *
 * @public
 */
export function DocxEditorColorByChangeType() {
  const registry = useContext(RevisionStyleRegistryContext);
  const id = useDeclarationId();
  useEffect(() => {
    if (!registry) return undefined;
    registry.registerScheme(id);
    return () => registry.unregister(id);
  }, [registry, id]);
  return null;
}

/**
 * Props for `DocxEditor.AuthorStyle`: one author, and the {@link RevisionAuthorStyle}
 * fields to apply — `color` (document ink and the review chrome's accent), `background`
 * (the wash), `activeBackground` (the open change's band), `spanClassName` (classes on
 * the painted spans), and `avatarUrl`.
 *
 * @public
 */
export interface DocxEditorAuthorStyleProps extends RevisionAuthorStyle {
  /** The author to style. Matches `w:author` exactly. */
  author: string;
}

/**
 * Declare one author's presentation, while mounted.
 *
 * Renders nothing. The editor already colours every author from the
 * `--doc-review-author-N` ramp; this overrides one of them, and leaves the rest where they
 * are. Prop changes re-apply live — pages repaint without a remount, so the caret and undo
 * history stay — and unmounting returns that author to the ramp.
 *
 * Read who is in the document with `useReviewAuthors`, and read these declarations back
 * inside a custom review card with `useReviewAuthor`.
 *
 * ```tsx
 * <DocxEditor.Root document={bytes} modules={MODULES}>
 *   <DocxEditor.AuthorStyle author="Jess Lin" color="#7c3aed" avatarUrl="/jess.png" />
 *   …
 * </DocxEditor.Root>
 * ```
 *
 * @public
 */
export function DocxEditorAuthorStyle(props: DocxEditorAuthorStyleProps) {
  const { author, color, background, activeBackground, spanClassName, avatarUrl } = props;
  const registry = useContext(RevisionStyleRegistryContext);
  const id = useDeclarationId();
  useEffect(() => {
    if (!registry) return undefined;
    registry.register(id, author, {
      ...(color !== undefined ? { color } : {}),
      ...(background !== undefined ? { background } : {}),
      ...(activeBackground !== undefined ? { activeBackground } : {}),
      ...(spanClassName !== undefined ? { spanClassName } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    });
    return () => registry.unregister(id);
  }, [registry, id, author, color, background, activeBackground, spanClassName, avatarUrl]);
  return null;
}
