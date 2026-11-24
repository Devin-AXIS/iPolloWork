<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Accept or reject without scrolling

Resolve a tracked change from your own list with `useReview().accept(item)` or `reject(item)`. Review writes such as accept, reject, and comment never scroll the page, and they need no prior activation.

## Resolve a change without scrolling

The following row opens its item without scrolling and resolves it from two buttons:

**React**

```tsx
import { useReview, type ReviewItemView } from '@docx-editor.dev/pro/react';

export function ChangeRow({ item }: { item: ReviewItemView }) {
  const { setActive, accept, reject, lastRefusal } = useReview();
  return (
    <li>
      <button onClick={() => setActive(item.key, { reveal: false })}>{item.text}</button>
      <button disabled={item.readOnly} onClick={() => accept(item)}>
        Accept
      </button>
      <button disabled={item.readOnly} onClick={() => reject(item)}>
        Reject
      </button>
      {lastRefusal?.key === item.key && <p role="alert">{lastRefusal.code}</p>}
    </li>
  );
}
```

**Vue**

```vue
<script setup lang="ts">
import { useReview, type ReviewItemView } from '@docx-editor.dev/pro/vue';

defineProps<{ item: ReviewItemView }>();
const { setActive, accept, reject, lastRefusal } = useReview();
</script>

<template>
  <li>
    <button @click="setActive(item.key, { reveal: false })">{{ item.text }}</button>
    <button :disabled="item.readOnly" @click="accept(item)">Accept</button>
    <button :disabled="item.readOnly" @click="reject(item)">Reject</button>
    <p v-if="lastRefusal?.key === item.key" role="alert">{{ lastRefusal.code }}</p>
  </li>
</template>
```

`accept` and `reject` return `false` when the editor refuses the decision, for example in viewing mode. `lastRefusal` holds the item key and the diagnostic code. In Vue it is a ref, so read `lastRefusal.value?.code` in script.

## Activate without scrolling

`setActive(key, { reveal: false })` moves the caret to the item and keeps the scroll position. `reveal` takes `false` or one of four placements:

| Value | Where the item lands |
| --- | --- |
| `'centerIfNeeded'` (default) | Stays still when the item is on screen; centered when it has to travel. |
| `'center'` | Always centered. |
| `'nearest'` | The smallest scroll that brings it into view. |
| `'start'` | Near the top of the viewport. |

Add `announce: true` to open the packaged balloon or card for the item.

## Limits

- Disable the decision buttons for items where `item.readOnly` is `true`.
- If the whole row is clickable, stop button clicks from reaching it, so a decision does not also activate the item.
- Headless pipelines have no viewport. To decide changes on a server, call `Revision.accept()` or `Revision.reject()`. For more information, see [Tracked changes](https://www.docx-editor.dev/docs/2.x/editor-api/revisions).

## See also

- [Tracked changes](https://www.docx-editor.dev/docs/2.x/pro/tracked-changes)
- [Diagnostics](https://www.docx-editor.dev/docs/2.x/guides/diagnostics)
- [Custom cards in the review rail](./custom-review-cards.md)
