<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Comment on found text

Find text with `editor.findMatches`, select a match with `editor.selectMatch`, and comment with `useReview().comment`. On a server, search with `body.search` and call `Range.insertComment`.

## Comment on a search result

The following button comments on the first whole-word match of a term. The editor needs an `author` and `reviewModule()` in its modules.

```tsx
import { useState } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import { useReview } from '@docx-editor.dev/pro/react';

export function CommentOnTerm({ term }: { term: string }) {
  const editor = useDocxEditor();
  const { comment, lastRefusal } = useReview();
  const [status, setStatus] = useState('');
  const run = () => {
    const [match] = editor?.findMatches(term, { wholeWord: true }) ?? [];
    if (!match || !editor?.selectMatch(match).ok) return setStatus('No match');
    setStatus(comment(`Define "${term}".`) ? '' : 'Refused');
  };
  return (
    <>
      <button onClick={run}>Comment on {term}</button>
      {/* lastRefusal updates on the next render, so read it here. */}
      <span role="status">{status === 'Refused' ? lastRefusal?.code : status}</span>
    </>
  );
}
```

Comment only after `selectMatch(match).ok` is `true`. `selectMatch` opens the header, footer, or note that holds the match. `comment` returns `false` when the editor refuses the write, and `lastRefusal` holds the diagnostic code.

## Comment on a server

The following example searches the body, not every story, and saves the result:

```ts
import { DocxEditor } from '@docx-editor.dev/editor-api';

const runtime = await DocxEditor.createServer(bytes, { author: 'Review bot' });
try {
  await runtime.run(async (context) => {
    const found = context.document.body.search(term, { matchWholeWord: true });
    found.load('items');
    await context.sync();
    if (found.items.length === 0) return;
    found.items[0]!.insertComment(`Define "${term}".`);
    await context.sync();
  });
  const saved = await runtime.save();
} finally {
  runtime.dispose();
}
```

Load the search results before you read them, and end with `await context.sync()` to send the queued comment. The runtime writes the comment as its `author` option.

## See also

- [Comments](https://www.docx-editor.dev/docs/2.x/pro/comments)
- [Diagnostics](https://www.docx-editor.dev/docs/2.x/guides/diagnostics)
- [Replace as a tracked change](./tracked-replacement.md)
