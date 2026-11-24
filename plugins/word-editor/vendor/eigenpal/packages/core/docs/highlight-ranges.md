<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Highlight ranges

Call `useHighlights(name, source, options)` to mark text as a named set while a component is mounted. Highlights are local view state. They do not change the document and are not saved.

## Highlight matching text

The following component marks each whole-word match of a list of terms. Style the `glossary-term` class with your own CSS, or omit `className` for the default fill.

**React**

```tsx
import { useCallback } from 'react';
import { useHighlights, type Editor } from '@docx-editor.dev/react';

export function GlossaryMarks({ terms }: { terms: readonly string[] }) {
  // A stable function source, so the set refreshes only when `terms` changes.
  const findTerms = useCallback(
    (editor: Editor) => editor.findMatches(terms, { wholeWord: true }).flat(),
    [terms]
  );
  const { applied } = useHighlights('glossary', findTerms, { className: 'glossary-term' });
  return <span>{applied} marked</span>;
}
```

**Vue**

```vue
<script setup lang="ts">
import { useHighlights, type Editor } from '@docx-editor.dev/vue';

const props = defineProps<{ terms: readonly string[] }>();
// A source that reads props or refs runs again when they change.
const result = useHighlights(
  'glossary',
  (editor: Editor) => editor.findMatches(props.terms, { wholeWord: true }).flat(),
  { className: 'glossary-term' }
);
</script>

<template>
  <span>{{ result.applied }} marked</span>
</template>
```

A function source runs again after each document change, so the marks follow the text. The set is removed when the component unmounts.

## Check spelling and grammar

Call `editor.getParagraphs()` to read every paragraph, including paragraphs on pages that have not been painted. The list covers body text, tables, content controls, headers, footers, notes, and supported text boxes. Repeated headers and footers appear once. To read one paragraph, call `editor.getParagraphText(blockId)`.

The list is empty until a document opens. A large document opens in steps, so read the list again after each `change` event. A function source of `useHighlights` does this for you.

To check only what an edit touched, listen for the `paragraphsChange` event. It lists the `blockId` of each paragraph that a commit added, changed, or deleted, in every story. It fires after the `change` event of the same commit, and never for a selection or highlight change. Its `source` is `remote` for an edit from a collaboration peer, and `local` for other edits, including undo and redo. It fires for the undoable `replaceDocument` command, but not for `load()`, so check every paragraph when `getDocumentHandle().loadId` changes.

### Choose the text to check

Each paragraph has three parts:

- `acceptedText` is the paragraph text with every tracked change accepted. Insertions are in, and tracked deletions and move sources are out. Hidden text and optional hyphens are left out too. Check spelling and grammar in this text.
- `text` holds the offsets that `setHighlights()` takes and that the caret reports. It includes deleted and hidden text.
- `proofing` lists stretches of `acceptedText` with their language, such as `en-GB`, and a `noProof` flag. Skip text that has `noProof` set, and check other text in its own language. East Asian characters and complex-script text have their own language tags.

In `acceptedText`, a tab reads as `\t` and a line break as `\n`. An object, such as a picture, a note reference, a symbol, or a field, reads as U+FFFC. Treat all three as word boundaries. To check the saved text of fields, read `editor.getParagraphs({ fields: 'result' })`. That read does not change how the editor addresses fields.

`acceptedText` does not depend on the review display mode. In the `original` mode, the page shows the text with every change rejected, so a mark on inserted text does not show.

A tracked change can make a word misspelled, for example a deletion of one letter in the middle of the word. If `acceptedTextRanges()` returns more than one range for a word, a tracked change or hidden text splits it. Tell the reader that the word reads this way after the changes are accepted.

Loading or destroying the editor in a listener cancels remaining paragraph notifications for the previous document.

### Mark misspelled words

The following module, `spelling.ts`, checks every paragraph when a document opens. After that, it checks only paragraphs whose text object changed. It uses `Intl.Segmenter` with each proofing language to find words, including words with apostrophes. An invalid language tag uses the runtime's default language. The checker receives NFC-normalized words, but marks keep the original offsets. Each mark covers every visible part of its word.

The source skips the word at the caret only while the reader types in that paragraph. It counts an edit as typing when the caret paragraph changed since the last run. When a document opens, the caret is at the start of the first paragraph, and the first word still gets its mark.

```ts
// spelling.ts
import {
  acceptedOffsetFromText,
  acceptedTextRanges,
  type Editor,
  type HighlightRange,
  type ParagraphText,
} from '@docx-editor.dev/core';

/** Your checker. `lang` is the language tag of the word, or null. */
export interface SpellChecker {
  isMisspelled(word: string, lang: string | null): boolean;
  suggest(word: string, lang: string | null): readonly string[];
}

/** One mark for one misspelled word, with what a fix needs. */
export type SpellingRange = HighlightRange & {
  /** The word as `acceptedText` reads it. */
  readonly word: string;
  /** Where the word starts in `acceptedText`. */
  readonly acceptedStart: number;
  readonly suggestions: readonly string[];
};

const segmenters = new Map<string, Intl.Segmenter>();

function wordSegmenter(lang: string | null): Intl.Segmenter {
  const key = lang ?? '';
  let segmenter = segmenters.get(key);
  if (!segmenter) {
    try {
      segmenter = new Intl.Segmenter(lang ?? undefined, { granularity: 'word' });
    } catch {
      // A document can contain an invalid language tag.
      segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
    segmenters.set(key, segmenter);
  }
  return segmenter;
}

function check(paragraph: ParagraphText, checker: SpellChecker): SpellingRange[] {
  const marks: SpellingRange[] = [];
  for (const stretch of paragraph.proofing) {
    if (stretch.noProof) continue;
    const text = paragraph.acceptedText.slice(
      stretch.acceptedStart,
      stretch.acceptedStart + stretch.length
    );
    for (const segment of wordSegmenter(stretch.lang).segment(text)) {
      if (!segment.isWordLike) continue;
      const word = segment.segment;
      const from = stretch.acceptedStart + segment.index;
      // Look up the normalized word. The offsets stay on the original text.
      const lookup = word.normalize('NFC');
      if (!checker.isMisspelled(lookup, stretch.lang)) continue;
      // One range per visible part of the word. The mark covers all of them.
      const parts = acceptedTextRanges(paragraph, from, from + word.length);
      const first = parts[0];
      const last = parts.at(-1);
      if (!first || !last) continue;
      const end = last.start + last.length;
      const suggestions = checker.suggest(lookup, stretch.lang);
      marks.push({
        blockId: paragraph.blockId,
        start: first.start,
        length: end - first.start,
        expectedText: paragraph.text.slice(first.start, end),
        // Read by screen readers for the marked word.
        description: suggestions[0] ? `Spelling: did you mean ${suggestions[0]}?` : 'Spelling',
        word,
        acceptedStart: from,
        suggestions,
      });
    }
  }
  return marks;
}

/**
 * A highlight source that marks each misspelled word. It checks every paragraph when a
 * document opens, and then only paragraphs whose text object changed. While the
 * reader types in a paragraph, it skips the word at the caret.
 */
export function spellingSource(checker: SpellChecker) {
  const marks = new Map<string, SpellingRange[]>();
  const checked = new Map<string, ParagraphText>();
  let loadId: string | null = null;
  let seen: ParagraphText | null = null;
  let typing = false;
  const source = (editor: Editor): SpellingRange[] => {
    // A new document can reuse block IDs, so check all of it.
    const current = editor.getDocumentHandle().loadId;
    if (current !== loadId) {
      loadId = current;
      checked.clear();
      marks.clear();
      seen = null;
      typing = false;
    }
    const paragraphs = editor.getParagraphs();
    const present = new Set(paragraphs.map(({ blockId }) => blockId));
    for (const id of checked.keys()) {
      if (!present.has(id)) {
        checked.delete(id);
        marks.delete(id);
      }
    }
    for (const paragraph of paragraphs) {
      if (checked.get(paragraph.blockId) === paragraph) continue;
      checked.set(paragraph.blockId, paragraph);
      marks.set(paragraph.blockId, check(paragraph, checker));
    }
    const caret = editor.getSelectionRange()?.head;
    const here = caret ? editor.getParagraphText(caret.blockId) : null;
    // Typing starts with an edit in the caret paragraph and ends when the caret leaves it.
    typing = here !== null && here.blockId === seen?.blockId && (typing || here !== seen);
    seen = here;
    return [...marks.entries()].flatMap(([blockId, list]) => {
      if (!typing || !here || !caret || blockId !== here.blockId) return list;
      // The caret counts in `text`; the marks count in `acceptedText`.
      const at = acceptedOffsetFromText(here, caret.offset);
      return list.filter(
        (mark) => at < mark.acceptedStart || at > mark.acceptedStart + mark.word.length
      );
    });
  };
  return Object.assign(source, {
    invalidate() {
      checked.clear();
      marks.clear();
    },
  });
}

/**
 * Replace a marked word. `at` is where the mark is now, such as a context menu hit.
 * Returns false when the command refuses the fix, for example because the text changed.
 */
export function fixWord(
  editor: Editor,
  mark: SpellingRange,
  replacement: string,
  at: { readonly start: number } = mark
): boolean {
  const paragraph = editor.getParagraphText(mark.blockId);
  if (!paragraph) return false;
  const result = editor.exec({
    type: 'replaceAcceptedText',
    match: {
      blockId: mark.blockId,
      start: acceptedOffsetFromText(paragraph, at.start),
      length: mark.word.length,
      expectedText: mark.word,
    },
    text: replacement,
  });
  return result.ok;
}
```

`fixWord` runs the `replaceAcceptedText` command. It compares the word with the replacement and edits only the letters that differ, so the tracked changes of other authors stay where they are. The new letters go into the container of the letters they replace, such as a hyperlink or a content control. A fix of a word that a deletion splits edits each part and is one undo step. In suggesting mode, the fix is a tracked change under the editor's author.

The command refuses some fixes and changes nothing:

- If the word changed since it was checked, `expectedText` makes the command return `notFound`.
- If the replacement adds U+FFFC, the command returns `invalidArgs`. An object cannot be written as text.
- If the differing letters include an object, such as a field or a picture, the command returns `unsupported`. An object stays in place when the replacement keeps its U+FFFC at the same position.
- If the letters are in a locked or data-bound content control, the command returns `locked` or `bound`.

If two people fix the same word at the same time, both fixes can insert letters, so the checker marks the merged word again.

### Fix words from the context menu

The following component marks misspelled words and offers the suggestions for the word under a right-click. It runs the source again when the caret moves to another paragraph, so the word that the reader typed gets its mark.

**React**

```tsx
import { useMemo, useRef } from 'react';
import {
  DocxEditor,
  useContextMenuHighlights,
  useDocxEditor,
  useEditorEvent,
  useHighlights,
} from '@docx-editor.dev/react';
import { fixWord, spellingSource, type SpellChecker, type SpellingRange } from './spelling';

function SuggestionRows({ recheck }: { recheck: () => void }) {
  const editor = useDocxEditor();
  const [hit] = useContextMenuHighlights<SpellingRange>('spelling');
  if (!hit || !editor) return null;
  return (
    <>
      {hit.range.suggestions.map((suggestion) => (
        <DocxEditor.ContextMenu.Item
          key={suggestion}
          label={suggestion}
          // The hit says where the mark is now, after edits before it.
          onSelect={() => fixWord(editor, hit.range, suggestion, hit) || recheck()}
        />
      ))}
    </>
  );
}

// Render inside DocxEditor.Viewport. Pass a stable `checker`.
export function SpellingMarks({ checker }: { checker: SpellChecker }) {
  const source = useMemo(() => spellingSource(checker), [checker]);
  const { refresh } = useHighlights('spelling', source, {
    kind: 'spelling',
    className: 'spelling-error',
  });
  const caretParagraph = useRef<string | undefined>(undefined);
  useEditorEvent('selectionChange', (snapshot) => {
    const blockId = snapshot.selectionRange?.head.blockId;
    if (blockId === caretParagraph.current) return;
    caretParagraph.current = blockId;
    refresh();
  });
  return (
    <DocxEditor.ContextMenu>
      <DocxEditor.ContextMenu.Start>
        <SuggestionRows recheck={refresh} />
      </DocxEditor.ContextMenu.Start>
    </DocxEditor.ContextMenu>
  );
}
```

**Vue**

Save the suggestion rows in `SpellingRows.vue`. This child reads the context supplied by `ContextMenu.Start`.

```vue
<!-- SpellingRows.vue -->
<script setup lang="ts">
import { DocxEditor, useContextMenuHighlights, useDocxEditor } from '@docx-editor.dev/vue';
import { fixWord, type SpellingRange } from './spelling';

const props = defineProps<{ recheck: () => void }>();
const editor = useDocxEditor();
const hits = useContextMenuHighlights<SpellingRange>('spelling');

function fix(suggestion: string) {
  const hit = hits.value[0];
  if (!hit || !editor.value) return;
  if (!fixWord(editor.value, hit.range, suggestion, hit)) props.recheck();
}
</script>

<template>
  <template v-if="hits[0]">
    <DocxEditor.ContextMenu.Item
      v-for="suggestion in hits[0].range.suggestions"
      :key="suggestion"
      :label="suggestion"
      @select="fix(suggestion)"
    />
  </template>
</template>
```

Render this parent inside `DocxEditor.Viewport`. Pass a stable `checker`.

```vue
<script setup lang="ts">
import { DocxEditor, useEditorEvent, useHighlights } from '@docx-editor.dev/vue';
import { spellingSource, type SpellChecker } from './spelling';
import SpellingRows from './SpellingRows.vue';

const props = defineProps<{ checker: SpellChecker }>();
const source = spellingSource(props.checker);
const marks = useHighlights('spelling', source, {
  kind: 'spelling',
  className: 'spelling-error',
});

let caretParagraph: string | undefined;
useEditorEvent('selectionChange', (snapshot) => {
  const blockId = snapshot.selectionRange?.head.blockId;
  if (blockId === caretParagraph) return;
  caretParagraph = blockId;
  marks.value.refresh();
});
</script>

<template>
  <DocxEditor.ContextMenu>
    <DocxEditor.ContextMenu.Start>
      <SpellingRows :recheck="marks.refresh" />
    </DocxEditor.ContextMenu.Start>
  </DocxEditor.ContextMenu>
</template>
```

To fix words from a side list, keep the marks that the source returned, and call `fixWord(editor, mark, suggestion)` from the list. Build the list again after each `change` event. If `fixWord` returns false, the word changed, so check the document again.

If your dictionary changes, call `source.invalidate()`, then `refresh()` in React or `marks.value.refresh()` in Vue. This clears cached checks before the highlight source runs again.

### Make marks accessible

Marks are painted over the page, so assistive technology does not see them by default. Pass `kind: 'spelling'` or `kind: 'grammar'` in the options of a proofing set:

- The painted text that a mark covers gets `aria-invalid` with that value.
- A range with a `description` links it to the covered text with `aria-describedby`.
- If the browser supports the CSS Custom Highlight API, the covered text joins a `spelling-error` or `grammar-error` highlight. The browser reports that type to assistive technology and draws a wavy underline in `--doc-proofing-spelling-color` or `--doc-proofing-grammar-color`.
- A polite live region reads the number of issues of each kind after the count stops changing.

To move through the issues from the keyboard, run the `navigateHighlight` command. It selects the next or previous mark of a set in reading order and wraps at the end. With the word selected, the reader opens the context menu with Shift+F10 or the menu key, and the suggestion rows show.

```ts
import type { Editor } from '@docx-editor.dev/core';

/** Select the next or previous spelling mark, for your own shortcut or button. */
export function goToIssue(editor: Editor, direction: 'next' | 'previous'): boolean {
  return editor.exec({ type: 'navigateHighlight', name: 'spelling', direction }).ok;
}
```

### Check text asynchronously

If your checker runs on a server, keep the paragraph object and the document identity with each request. The document identity is `editor.getDocumentHandle().loadId`. It is new on every `load()`, which can reuse block IDs. When the result arrives, discard it if the `loadId` changed, or if `editor.getParagraphText(paragraph.blockId)` returns another object. Undo can return an earlier object, and its earlier result is still correct.

```ts
// check-remotely.ts
import type { Editor, ParagraphText } from '@docx-editor.dev/core';

/** Check one paragraph on a server. Resolves to null when the result is stale. */
export async function checkRemotely(
  editor: Editor,
  paragraph: ParagraphText,
  request: (text: string) => Promise<readonly { start: number; length: number }[]>
) {
  const loadId = editor.getDocumentHandle().loadId;
  const issues = await request(paragraph.acceptedText);
  const current = editor.getParagraphText(paragraph.blockId);
  if (editor.getDocumentHandle().loadId !== loadId || current !== paragraph) return null;
  return issues;
}
```

The following function sends every paragraph once, and then only the paragraphs that `paragraphsChange` lists. It keeps one result per paragraph, so a deleted paragraph drops its issues. The server returns offsets in `acceptedText`.

```ts
import { acceptedTextRanges, type Editor, type HighlightRange } from '@docx-editor.dev/core';
import { checkRemotely } from './check-remotely';

/** Check a document on a server and report every issue after each answer. */
export function watchGrammar(
  editor: Editor,
  request: (text: string) => Promise<readonly { start: number; length: number }[]>,
  report: (ranges: readonly HighlightRange[]) => void,
  onError: (error: unknown) => void
): () => void {
  let stopped = false;
  const results = new Map<string, readonly HighlightRange[]>();
  const publish = () => report([...results.values()].flat());
  const check = async (blockId: string) => {
    const paragraph = editor.getParagraphText(blockId);
    if (!paragraph) return;
    const issues = await checkRemotely(editor, paragraph, request);
    // Null: the paragraph changed, and a newer check of it is on its way.
    if (stopped || !issues) return;
    results.set(
      blockId,
      issues.flatMap(({ start, length }) =>
        acceptedTextRanges(paragraph, start, start + length).map((range) => ({
          ...range,
          expectedText: paragraph.text.slice(range.start, range.start + range.length),
        }))
      )
    );
    publish();
  };
  const schedule = (id: string) => {
    void check(id).catch((error: unknown) => {
      if (!stopped) onError(error);
    });
  };
  for (const paragraph of editor.getParagraphs()) schedule(paragraph.blockId);
  const off = editor.on('paragraphsChange', ({ added, changed, deleted }) => {
    for (const id of [...changed, ...deleted]) results.delete(id);
    publish();
    for (const id of [...added, ...changed]) schedule(id);
  });
  return () => {
    stopped = true;
    off();
    results.clear();
    report([]);
  };
}
```

Pass a `report` function that calls `editor.setHighlights('grammar', ranges, { kind: 'grammar' })`. Pass `onError` to report request failures in your application. Call the returned function on unmount to remove marks and ignore pending answers. After a new `load()`, stop the watch and start a new one.

A result can still go stale between the check and a fix. Pass the checked text as `expectedText` to `replaceAcceptedText`, so a stale fix returns `notFound` and changes nothing.

### Check terminology

To find a term, search `acceptedText`, not `editor.findMatches()`. Search finds the text that a tracked deletion removes, and it misses a term that a deletion splits. The following function marks each occurrence of a term with one mark.

```ts
import { acceptedTextRanges, type Editor, type HighlightRange } from '@docx-editor.dev/core';

export function termMarks(editor: Editor, term: string): HighlightRange[] {
  const marks: HighlightRange[] = [];
  if (term.length === 0) return marks;
  for (const paragraph of editor.getParagraphs()) {
    for (let at = paragraph.acceptedText.indexOf(term); at >= 0;) {
      const parts = acceptedTextRanges(paragraph, at, at + term.length);
      const first = parts[0];
      const last = parts.at(-1);
      if (first && last) {
        const end = last.start + last.length;
        marks.push({
          blockId: paragraph.blockId,
          start: first.start,
          length: end - first.start,
          expectedText: paragraph.text.slice(first.start, end),
        });
      }
      at = paragraph.acceptedText.indexOf(term, at + term.length);
    }
  }
  return marks;
}
```

To replace a term, run `replaceAcceptedText` with the term's offset in `acceptedText` and the term as `expectedText`.

## Run the source again

A function source runs again after document changes. If it also reads your own state, call `refresh()` after that state changes. Examples are a word that you add to a dictionary, or a result that arrives from a server. The following component stops marking a term after you ignore it.

**React**

```tsx
import { useCallback, useRef } from 'react';
import { useHighlights, type Editor } from '@docx-editor.dev/react';

export function TermMarks({ terms }: { terms: readonly string[] }) {
  const ignored = useRef(new Set<string>());
  const findTerms = useCallback(
    (editor: Editor) =>
      editor
        .findMatches(terms, { wholeWord: true })
        .flat()
        .filter((match) => !ignored.current.has(match.text)),
    [terms]
  );
  const { refresh } = useHighlights('terms', findTerms);
  const ignore = (term: string) => {
    ignored.current.add(term);
    refresh();
  };
  return <button onClick={() => ignore(terms[0] ?? '')}>Ignore first term</button>;
}
```

**Vue**

```vue
<script setup lang="ts">
import { useHighlights, type Editor } from '@docx-editor.dev/vue';

const props = defineProps<{ terms: readonly string[] }>();
// A plain Set is not reactive, so the source does not run again by itself.
const ignored = new Set<string>();
const marks = useHighlights('terms', (editor: Editor) =>
  editor
    .findMatches(props.terms, { wholeWord: true })
    .flat()
    .filter((match) => !ignored.has(match.text))
);
function ignore(term: string) {
  ignored.add(term);
  marks.value.refresh();
}
</script>

<template>
  <button @click="ignore(props.terms[0] ?? '')">Ignore first term</button>
</template>
```

`refresh()` replaces a run that waits for typing to pause, so the source runs once. In React, the set updates at once, and `refresh` keeps its identity across renders. Call it from an effect or an event handler, not during render. In Vue, the set updates in the next flush, before the next paint. After the component unmounts, `refresh()` does nothing.

## Read highlights in the context menu

Call `useContextMenuHighlights(name)` in a row inside `ContextMenu.Start` to read the highlights that the menu is about. For a right-click, these are the highlights under the pointer. If the menu opens from the keyboard, with Shift+F10 or the Menu key, these are the highlights that contain the caret. Add your own fields to each range, and read them back from `range`. The following rows offer a replacement for a marked term, from a right-click or from the keyboard.

**React**

```tsx
import {
  DocxEditor,
  useContextMenuHighlights,
  useDocxEditor,
  useHighlights,
  type Editor,
  type TextMatch,
} from '@docx-editor.dev/react';

type TermRange = TextMatch & { readonly replacement: string };

function ReplacementRows({ recheck }: { recheck: () => void }) {
  const editor = useDocxEditor();
  const [hit] = useContextMenuHighlights<TermRange>('terms');
  if (!hit || !editor) return null;
  const replace = () => {
    const result = editor.exec({
      type: 'replaceMatch',
      // Where the term is now, and the text it must still have.
      match: {
        blockId: hit.range.blockId,
        start: hit.start,
        length: hit.length,
        expectedText: hit.range.text,
      },
      text: hit.range.replacement,
    });
    // The text changed after the menu opened: check the document again.
    if (!result.ok && result.code === 'notFound') recheck();
  };
  return <DocxEditor.ContextMenu.Item label={hit.range.replacement} onSelect={replace} />;
}

// Render inside DocxEditor.Viewport. Pass a stable `findTerms`, such as one from useCallback.
export function TermMenu({ findTerms }: { findTerms: (editor: Editor) => TermRange[] }) {
  const { refresh } = useHighlights('terms', findTerms);
  return (
    <DocxEditor.ContextMenu>
      <DocxEditor.ContextMenu.Start>
        <ReplacementRows recheck={refresh} />
      </DocxEditor.ContextMenu.Start>
    </DocxEditor.ContextMenu>
  );
}
```

**Vue**

```vue
<script setup lang="ts">
import {
  DocxEditor,
  useContextMenuHighlights,
  useDocxEditor,
  type TextMatch,
} from '@docx-editor.dev/vue';

type TermRange = TextMatch & { readonly replacement: string };

// Pass `refresh` from the value of useHighlights('terms', ...).
const props = defineProps<{ recheck: () => void }>();
const editor = useDocxEditor();
const hits = useContextMenuHighlights<TermRange>('terms');

function replace() {
  const hit = hits.value[0];
  if (!hit || !editor.value) return;
  const result = editor.value.exec({
    type: 'replaceMatch',
    // Where the term is now, and the text it must still have.
    match: {
      blockId: hit.range.blockId,
      start: hit.start,
      length: hit.length,
      expectedText: hit.range.text,
    },
    text: hit.range.replacement,
  });
  // The text changed after the menu opened: check the document again.
  if (!result.ok && result.code === 'notFound') props.recheck();
}
</script>

<template>
  <DocxEditor.ContextMenu.Item
    v-if="hits[0]"
    :label="hits[0].range.replacement"
    @select="replace"
  />
</template>
```

A highlight moves with its text, so use the hit's `start` and `length`, not the offsets of `range`. The hook reads the highlights again when the document changes while the menu is open. A term that moves away from the pointer or the caret is no longer reported. `expectedText` makes the replacement refuse with `notFound` if the text changed anyway.

For a keyboard open, a highlight counts when the caret is inside it or at either end, in the same paragraph. For a range selection, the caret is the end where the selection stops. The hit's `rect` is the highlight's rectangle on the caret's line. The hook returns an empty array while the menu is closed. To tell a right-click from a keyboard open, call `useContextMenuAnchor()` and check `trigger`.

## Configure a highlight set

| Argument or field | Description |
| --- | --- |
| `name` | The set name. Two sets with the same name replace each other's ranges. |
| `source` | The ranges, or a function of the editor that returns them. |
| `options.className` | CSS classes added to every mark of the set. |
| `options.activeIndex` | The range to show in the active color, such as the current result of your own search list. |
| `options.kind` | `spelling` or `grammar` for proofing marks. Makes the marks available to assistive technology. For more information, see [Make marks accessible](#make-marks-accessible). |
| `applied` | The number of ranges that resolve and paint. |
| `unavailable` | The number of ranges that do not resolve or paint. While a large document lays out in the background, it includes ranges on pages that are not laid out yet, and it updates as they are. |
| `refresh()` | Runs the source again, or applies an array again. |

## Use highlights outside components

Call `watchHighlights(editor, name, source, options)` from `@docx-editor.dev/core/editor` to follow document changes. Call `stop()` on the returned watch to remove the set and stop watching. For a fixed set that does not refresh, call `editor.setHighlights`.

## See also

- [Highlight text ranges](https://www.docx-editor.dev/docs/2.x/guides/navigation#highlight-text-ranges)
- [React hooks](https://www.docx-editor.dev/docs/2.x/react/hooks#usehighlights)
- [Vue composables](https://www.docx-editor.dev/docs/2.x/vue/composables#usehighlights)
