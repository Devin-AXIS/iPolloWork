import { repositionInlineDrawingsForBaseline } from './drawing-layout.ts';
import type { PendingLine } from './pending-line.ts';
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';

/** Reposition drawings without replacing the pending line's owned drawing array. */
export function repositionPendingDrawings(line: PendingLine): void {
  if (!line.drawings.length) return;
  const repositioned = repositionInlineDrawingsForBaseline(line.drawings, line.baseline);
  line.drawings.length = 0;
  for (const drawing of repositioned) line.drawings.push(drawing);
}

/** Synchronize the glyph baseline before paragraph line spacing changes the line box. */
export function syncPendingDrawingBaselines(line: PendingLine, pageBreaksIgnored: boolean): void {
  if (!line.drawings.length) return;
  if (line.spans.every((span) => pageBreaksIgnored && span.text === PAGE_BREAK_CHAR))
    for (const drawing of line.drawings)
      line.baseline = Math.max(line.baseline, drawing.y + drawing.height);
  repositionPendingDrawings(line);
  for (const drawing of line.drawings)
    line.baseline = Math.max(line.baseline, drawing.y + drawing.height);
}
