// paintRemoteSelections must not re-walk the document for an unchanged remote selection.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { paintRemoteSelections } from '../surface-remote-selection.ts';
import { everyStoryOrder } from '../../layout/document-order.ts';
import { presenceWalkRecorder } from '../../layout/selection-rects.ts';
import type {
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../../layout/semantic-records.ts';
import type { CollaborationRemoteSelection } from '../../collaboration/index.ts';

function lineOf(paragraphId: string, index: number): LineRecord {
  return {
    id: `${paragraphId}-l${index}`,
    range: { paragraphId, start: 0, end: 10 },
    spans: [],
    box: { x: 0, y: index * 14, width: 400, height: 14 },
    contentX: 0,
    baseline: 11,
    leading: 0,
  } as LineRecord;
}

function paragraphOf(paragraphId: string, lineCount: number): ParagraphFragmentRecord {
  const lines: LineRecord[] = [];
  for (let index = 0; index < lineCount; index += 1) lines.push(lineOf(paragraphId, index));
  return {
    kind: 'paragraph',
    id: `${paragraphId}-frag`,
    paragraphId,
    fragmentIndex: 0,
    lines,
    box: { x: 0, y: 0, width: 400, height: lineCount * 14 },
  } as unknown as ParagraphFragmentRecord;
}

function layoutOf(pageCount: number): SemanticLayout {
  const pages: PageRecord[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    pages.push({
      id: `page-${index}`,
      index,
      box: { x: 0, y: 0, width: 612, height: 792 },
      contentBox: { x: 72, y: 72, width: 468, height: 648 },
      fragments: [paragraphOf(`body-${index}`, 8)],
    } as PageRecord);
  }
  return { revision: 1, pages };
}

function remoteOver(layout: SemanticLayout): CollaborationRemoteSelection {
  const last = `body-${layout.pages.length - 1}`;
  return {
    actorId: 'bob',
    name: 'Bob',
    anchor: { paragraphId: 'AAAAAAAA', nodeId: 'body-0', offset: 0 },
    head: { paragraphId: 'CCCCCCCC', nodeId: last, offset: 10 },
  };
}

describe('paintRemoteSelections cost', () => {
  test('a materialized-page bound walks only those pages', () => {
    const layout = layoutOf(60);
    const layer = document.createElement('div');
    const recorder = presenceWalkRecorder();
    recorder.reset();
    paintRemoteSelections(layer, layout, [remoteOver(layout)], {
      scale: 1,
      pages: new Set([0, 1]),
    });
    expect(recorder.pages).toBe(2);
    expect(recorder.lines).toBe(16);
    expect(everyStoryOrder(layout).length).toBe(60);
  });

  test('a repeat paint of the same selection on the same layout walks nothing', () => {
    const layout = layoutOf(60);
    const layer = document.createElement('div');
    const remotes = [remoteOver(layout)];
    const recorder = presenceWalkRecorder();
    paintRemoteSelections(layer, layout, remotes, { scale: 1, pages: new Set([0, 1]) });
    recorder.reset();
    paintRemoteSelections(layer, layout, remotes, { scale: 1, pages: new Set([0, 1]) });
    expect(`${recorder.pages} pages / ${recorder.lines} lines`).toBe('0 pages / 0 lines');
  });

  test('a repeat paint repaints when something else emptied the layer', () => {
    // The surface clears this layer itself when it has no replica to draw. If the skip trusted
    // its inputs alone, equal inputs after such a clear would leave the overlay empty and drop
    // every remote caret until some unrelated input changed.
    const layout = layoutOf(60);
    const layer = document.createElement('div');
    const remotes = [remoteOver(layout)];
    paintRemoteSelections(layer, layout, remotes, { scale: 1, pages: new Set([0, 1]) });
    const painted = layer.childElementCount;
    expect(painted).toBeGreaterThan(0);

    layer.replaceChildren();
    paintRemoteSelections(layer, layout, remotes, { scale: 1, pages: new Set([0, 1]) });
    expect(layer.childElementCount).toBe(painted);
  });
});
