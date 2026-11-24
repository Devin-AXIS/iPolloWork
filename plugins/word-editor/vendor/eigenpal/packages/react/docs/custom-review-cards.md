<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Custom cards in the review rail

Render `DocxEditorReview` with `preset` set to `false` and put your card component inside it. The component reads items from `useReview()`, measures cards with `useReviewCardHeights()`, stacks them with `useStackedReviewPositions`, and converts positions to pixels with `useReviewRailMetrics()`.

## Render custom cards

The following example measures each card, stacks the cards, and shows a refused decision:

```tsx
import {
  DocxEditorReview,
  useReview,
  useReviewCardHeights,
  useReviewRailMetrics,
  useStackedReviewPositions,
} from '@docx-editor.dev/pro/react';

function MyCards() {
  const { items, selectionAnchorY, accept, lastRefusal } = useReview();
  const metrics = useReviewRailMetrics();
  const { heights, cardRef } = useReviewCardHeights(items);
  const positions = useStackedReviewPositions(items, heights, {
    scale: metrics.scale,
    defaultHeight: 96,
  });
  const top = (y: number) => metrics.top + y * metrics.scale;
  return (
    <>
      {items.map((item) => (
        <div
          key={item.key}
          ref={cardRef(item.key)}
          style={{ position: 'absolute', top: top(positions.get(item.key) ?? 0) }}
        >
          {item.text}
          {item.kind === 'revision' && <button onClick={() => accept(item)}>Accept</button>}
          {lastRefusal?.key === item.key && <p>{lastRefusal.code}</p>}
        </div>
      ))}
      <DocxEditorReview.Draft top={top(selectionAnchorY ?? 0)} />
    </>
  );
}

export function MyRail() {
  return (
    <DocxEditorReview preset={false}>
      <MyCards />
      <DocxEditorReview.AddComment />
    </DocxEditorReview>
  );
}
```

`accept` returns `false` when the editor refuses, and `lastRefusal` names the item and the diagnostic code. `DocxEditorReview` already announces each refusal in a live region, so show it in the card as plain text. For a translated sentence, call `useReviewRefusalMessage()`.

## Position cards and drafts

Convert a layout position to CSS pixels with `metrics.top + position * metrics.scale`.

| Input to `useStackedReviewPositions` | Description |
| --- | --- |
| `heights` | Measured card heights in CSS pixels, by item key, from `useReviewCardHeights(items)`. A card without a height reserves `defaultHeight`, and a taller card overlaps the next one until it is measured. |
| `scale` | `metrics.scale`, CSS pixels per layout point. |
| `defaultHeight` | The height to reserve before a card is measured. |

`DocxEditorReview.Draft` renders only while a comment draft is open. Without `top`, it takes the packaged stack's position, so pass `top` from your own stack. To keep the box clear of your cards, add an entry at `selectionAnchorY` to the list that you stack, in document order.

## Place review parts

`DocxEditorReview` finds its parts among its own children by element type. Fragments are transparent in React and Vue.

| Part | Placement |
| --- | --- |
| `List`, `Markers`, `AddComment`, `Balloon` | Direct children of `DocxEditorReview`. Inside your own wrapper, a part renders as plain content without its geometry. |
| `Draft` | A direct child, or inside your own card component. Inside a custom stack, pass `top` explicitly. |
| `Card`, `Empty`, and card parts such as `Author`, `Summary`, `Accept`, and `Reply` | Inside `DocxEditorReview.List`. |

With `preset` set to `false`, the rail adds no defaults, but recognized parts keep their wiring. Other children render inside the rail element.

## Limits

- `useReviewCardHeights()` observes each card in its own window, so it works in a pop-out window. It stops observing when the component unmounts, and drops the height of each item that leaves `items`. Pass the full item list, not only the cards on screen. In Vue, put `cardRef` on an element, or on a component with one root element that does not change.
- To hide a card, unmount it. A card hidden with `display: none` measures zero, so it keeps its last height and its space in the stack.
- If you measure cards yourself, compare each height with the last one you recorded outside component state, and write state only when it differs. In React, also pass a stable ref callback. A state write on every commit can cause a render loop.
- In the compact rail, `metrics.compact` is `true`. Place cards at `metrics.compactCardLeft`; `Draft` does this itself.
- Keep the column hidden while `metrics.left` is `null`.

## See also

- [Review cards](https://www.docx-editor.dev/docs/2.x/customization/review-cards)
- [Tracked changes](https://www.docx-editor.dev/docs/2.x/pro/tracked-changes)
- [Accept or reject without scrolling](./accept-reject-without-scrolling.md)
