// A named text highlight set for as long as a component is mounted: a binding over the
// engine's `watchHighlights`, which reruns a function source after document changes and
// applies fixed ranges again after a refresh.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HighlightOptions, HighlightResult } from '@docx-editor.dev/core/contracts/editor';
import {
  HIGHLIGHT_REFRESH_MS,
  watchHighlights,
  type HighlightSource,
  type HighlightWatch,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';

export { HIGHLIGHT_REFRESH_MS, type HighlightSource };

const EMPTY_RESULT: HighlightResult = Object.freeze({ applied: 0, unavailable: 0 });

/**
 * What {@link useHighlights} returns: the counts of the last application, and `refresh` to
 * run the source again. @public
 */
export interface UseHighlightsReturn extends HighlightResult {
  /**
   * Run the source again now, for changes the editor cannot see: a word added to your
   * dictionary, the caret leaving the word being typed, or an asynchronous result arriving.
   * An array source applies again.
   *
   * The set updates synchronously, and a run that was waiting for typing to pause is
   * replaced by this one. Call it from an effect or an event handler, not during render. It
   * keeps the same identity across renders, and does nothing before the editor is ready or
   * after the component unmounts.
   */
  readonly refresh: () => void;
}

function optionsKey(options: HighlightOptions | undefined): string {
  if (!options) return '';
  const { color, activeColor, activeIndex, className, priority, kind } = options;
  return JSON.stringify([color, activeColor, activeIndex, className, priority, kind]);
}

/**
 * Highlight text ranges as the named set while the component is mounted, and keep them
 * current as the document changes. Returns what the last application resolved, and
 * `refresh` to run the source again when your own state changes.
 *
 * Use a unique `name` per hook: two hooks with the same name replace each other's ranges.
 * Keep a function `source` stable with `useCallback`. A function source runs again after
 * document changes and when its identity changes. For state it reads through a ref, such as
 * a dictionary or a result cache, call `refresh()` instead of creating a new function.
 *
 * @example
 * ```tsx
 * const findTerms = useCallback(
 *   (editor: Editor) => editor.findMatches(terms, { wholeWord: true }).flat(),
 *   [terms]
 * );
 * const { applied, refresh } = useHighlights('glossary', findTerms, {
 *   className: 'glossary-term',
 * });
 * ```
 *
 * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/highlight-ranges | Highlight ranges}
 * @public
 */
export function useHighlights(
  name: string,
  source: HighlightSource,
  options?: HighlightOptions
): UseHighlightsReturn {
  const editor = useDocxEditor();
  const [result, setResult] = useState(EMPTY_RESULT);
  const watchRef = useRef<{ watch: HighlightWatch; source: HighlightSource; key: string } | null>(
    null
  );
  // Options compare by value, so an inline object literal does not reapply every render.
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const latestSource = useRef(source);
  latestSource.current = source;
  const key = optionsKey(options);

  // One watch per editor and name. Stopping removes the set.
  useEffect(() => {
    if (!editor) {
      setResult(EMPTY_RESULT);
      return undefined;
    }
    const watch = watchHighlights(editor, name, latestSource.current, {
      ...latestOptions.current,
      onResult: setResult,
    });
    watchRef.current = {
      watch,
      source: latestSource.current,
      key: optionsKey(latestOptions.current),
    };
    setResult(watch.result);
    return () => {
      watch.stop();
      watchRef.current = null;
    };
  }, [editor, name]);

  // A new source or options update the set in place, keeping its stacking position.
  useEffect(() => {
    const current = watchRef.current;
    if (!current || (current.source === source && current.key === key)) return;
    current.source = source;
    current.key = key;
    current.watch.update(source, latestOptions.current ?? {});
  }, [source, key]);

  // Read the watch at call time: stable, and a no-op without one.
  const refresh = useCallback(() => watchRef.current?.watch.refresh(), []);
  return useMemo(() => ({ ...result, refresh }), [result, refresh]);
}
