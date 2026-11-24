// The store behind `<DocxEditor.AuthorStyle>` and `<DocxEditor.ColorByChangeType>` — the
// declarative form of the engine's revision styles.
//
// Why a store at all: the painted document needs ONE answer per author before it paints,
// and JSX declares that answer in many places (one component per author, mounted anywhere
// under the Root). Something has to merge the declarations and hand the engine the merged
// scheme, and re-hand it when one mounts, changes, or unmounts. That something is this
// registry: the Root owns one, connects it to the live editor instance, and every
// declaration writes its entry here.

import { createContext } from 'react';
import type {
  DocxEditorInstance,
  RevisionAuthorStyle,
  RevisionStyles,
} from '@docx-editor.dev/core/editor';

export interface RevisionStyleRegistry {
  /**
   * `<ColorByChangeType>`: authors WITHOUT a declaration fall back to the kind colours
   * instead of the ramp, held while at least one is mounted.
   */
  registerScheme(id: symbol): void;
  /** `<AuthorStyle>`: upsert one author's declaration. Later mounts win for a repeat. */
  register(id: symbol, author: string, style: RevisionAuthorStyle): void;
  unregister(id: symbol): void;
  /** Attach the live editor. `null` on teardown. */
  connect(editor: DocxEditorInstance | null): void;
  /**
   * What the declarations currently compose to, or `undefined` when nothing is declared.
   *
   * The Root reads this when it CREATES the instance, so declarations mounted in the same
   * commit reach the engine as construction config and the FIRST paint is already styled —
   * without this, they would apply one paint later and the document would open in the
   * wrong colours for a frame.
   */
  current(): RevisionStyles | undefined;
}

export function createRevisionStyleRegistry(): RevisionStyleRegistry {
  const schemes = new Set<symbol>();
  const entries = new Map<symbol, { author: string; style: RevisionAuthorStyle }>();
  // MOUNT ORDER, held apart from the Map. React runs a CHANGED declaration as
  // cleanup-then-effect, so `unregister` + `register` would move that entry to the end of a
  // Map and promote it above a later duplicate — editing the first of two declarations for
  // one author flipped which one won. An id keeps the rank it was first given.
  const ranks = new Map<symbol, number>();
  let nextRank = 0;
  let editor: DocxEditorInstance | null = null;
  let overriding = false;

  function current(): RevisionStyles | undefined {
    if (schemes.size === 0 && entries.size === 0) return undefined;
    if (entries.size === 0) return 'kind';
    // `Object.create(null)`: author names are JSX props here, but the same record shape
    // also carries file-derived names elsewhere — a null prototype keeps a name like
    // `__proto__` an ordinary key instead of a silent no-op.
    const authors: Record<string, RevisionAuthorStyle> = Object.create(null);
    // Later mounts win, by first-registration rank rather than by Map order — see `ranks`.
    const ordered = [...entries].sort((a, b) => (ranks.get(a[0]) ?? 0) - (ranks.get(b[0]) ?? 0));
    for (const [, { author, style }] of ordered) authors[author] = style;
    // Authors without a declaration take the ramp — the engine's default — unless a
    // `<ColorByChangeType>` is mounted to put them back on the kind colours, which is how
    // "highlight these reviewers, leave everyone else green and red" is composed.
    return { authors, others: schemes.size > 0 ? 'kind' : 'author' };
  }

  /** The last scheme handed to the engine, as its key, so an equal write is skipped. */
  let written: string | null = null;
  let scheduled = false;

  /** A stable identity for a composed scheme, for the equality check above. */
  function schemeKey(styles: RevisionStyles | undefined): string {
    if (styles === undefined) return 'none';
    if (typeof styles === 'string') return styles;
    const authors = Object.entries(styles.authors)
      .map(([author, style]) => `${author}\u0000${JSON.stringify(style)}`)
      .sort();
    return `${styles.others ?? 'kind'}\u0001${authors.join('\u0001')}`;
  }

  function flush(): void {
    if (!editor) return;
    const styles = current();
    const key = schemeKey(styles);
    if (key === written) return;
    if (styles === undefined) {
      // The last declaration left. Restore only when this registry owns the scheme, so a
      // registry that never declared anything leaves a host's own configuration alone.
      // It restores the ENGINE DEFAULT, not whatever a host may have written imperatively
      // in between — which is why the documented lane is the declarations, not both.
      if (overriding) {
        // Back to the engine's default, which is by-author — not to the kind colours.
        editor.setRevisionStyles('author');
        overriding = false;
        written = key;
      }
      return;
    }
    editor.setRevisionStyles(styles);
    overriding = true;
    written = key;
  }

  /**
   * COALESCED, deliberately. Each declaration registers in its own effect, and React runs a
   * changed one as cleanup-then-effect — so an unbatched write would take the document to
   * the default and back for a single colour change, repainting every page twice and
   * flashing the wrong colours in between. Ten declarations mounting together would repaint
   * ten times. One microtask at the end of the effect flush writes the merged scheme once,
   * and the key check drops it entirely when nothing actually moved.
   */
  function apply(): void {
    if (!editor || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      flush();
    });
  }

  return {
    registerScheme(id) {
      schemes.add(id);
      apply();
    },
    register(id, author, style) {
      if (!ranks.has(id)) ranks.set(id, nextRank++);
      entries.set(id, { author, style });
      apply();
    },
    unregister(id) {
      const removed = schemes.delete(id) || entries.delete(id);
      if (removed) apply();
    },
    connect(next) {
      editor = next;
      // A fresh instance opened with `current()` as its construction config, so the scheme
      // it already holds is exactly what this registry would write — record that, and the
      // key check turns the connect into a no-op instead of a redundant repaint.
      //
      // OWNERSHIP FOLLOWS THE SEED. Declarations that reached the instance as config are
      // this registry's, even though it never called the setter for them: unmounting the
      // last one has to restore the default. Only an instance that opened with NO
      // declaration belongs to whatever the host configured, and stays untouched.
      const seeded = current();
      overriding = next !== null && seeded !== undefined;
      written = next === null ? null : schemeKey(seeded);
      apply();
    },
    current,
  };
}

export const RevisionStyleRegistryContext = createContext<RevisionStyleRegistry | null>(null);
