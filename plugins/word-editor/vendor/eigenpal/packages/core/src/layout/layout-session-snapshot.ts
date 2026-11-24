// A layout session as it stood before a pass, for a host that drops a paused pass.
//
// A pass replaces the session's fields rather than mutating them, so a shallow copy restores
// a single-section session. A multi-section pass also writes each section's session and the
// shared multi-section state, and a notes pass writes its search memo and the reserves each
// section session's checkpoints were laid out under. Putting all of that back is what lets a
// newer edit drop such a pass instead of first finishing it.

import type { LayoutSession } from './layout-session.ts';
import { saveReserveContext, takeReadReserves } from './note-reserve-resume.ts';
import { takeMovedSeedReserves } from './note-reserves.ts';

/** Save `session`, its section sessions and its notes memo; the answer puts them back. */
export function snapshotLayoutSession(session: LayoutSession): () => void {
  const fields = { ...session };
  const restoreReserves = saveReserveContext(session);
  const multi = session.multi;
  const multiFields = multi ? { ...multi } : null;
  const sections = multi ? multi.sections.map(snapshotLayoutSession) : [];
  const notes = typeof session.notes === 'object' ? session.notes : null;
  const notesFields = notes ? { ...notes } : null;
  return () => {
    Object.assign(session, fields);
    restoreReserves();
    if (multi && multiFields) Object.assign(multi, multiFields);
    for (const restore of sections) restore();
    if (notes && notesFields) Object.assign(notes, notesFields);
    // Recorded and taken within one pass: a dropped pass may leave one behind.
    takeMovedSeedReserves(session);
    takeReadReserves(session);
  };
}
