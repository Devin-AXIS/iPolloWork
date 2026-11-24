// A page break directly followed by a line break breaks no page.
//
// The line break still ends the line, so text after the pair continues on the next line of
// the same page. Measured in compatibility modes 14, 15 and none, with room on the page and
// after a full page, and with text before the page break on the same line.
// `paragraph-flow.ts` tests the same pair inline: a `line` break piece is the line break.

import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';

interface BreakPiece {
  readonly text: string;
  readonly breakKind?: string;
}

/** Whether the page break piece at `index` gives way to a line break right after it. */
export function pageBreakYieldsToLineBreak(pieces: readonly BreakPiece[], index: number): boolean {
  const next = pieces[index + 1];
  return (
    pieces[index]?.text === PAGE_BREAK_CHAR && next?.text === '\n' && next.breakKind === 'line'
  );
}
