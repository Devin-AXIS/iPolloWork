import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { framedTokenJoin } from './layout-cache.ts';

// A story root is immutable. Identity detects text and formatting edits without walking
// the entire hosted story each time a drawing token is requested.
const textboxContentIdentities = new WeakMap<OoxmlNode, number>();
let textboxContentIdentityCounter = 0;

export function textboxLayoutToken(story: NonNullable<DrawingProjection['textboxStory']>): string {
  let identity = textboxContentIdentities.get(story.content);
  if (identity === undefined) {
    identity = ++textboxContentIdentityCounter;
    textboxContentIdentities.set(story.content, identity);
  }
  return framedTokenJoin([
    String(identity),
    story.contentNodeId,
    String(story.insetsEmu.top),
    String(story.insetsEmu.right),
    String(story.insetsEmu.bottom),
    String(story.insetsEmu.left),
    story.verticalAnchor,
    story.autofit,
    story.fillHex ?? '',
    story.strokeHex ?? '',
    String(story.strokeWidthEmu),
    // Appended only when set, so wrapped boxes keep their existing tokens.
    ...(story.noWrap ? ['nowrap'] : []),
    // The frame is file-derived numbers and fixed names, so its JSON is a stable key.
    ...(story.legacyFrame ? ['frame', JSON.stringify(story.legacyFrame)] : []),
    ...(story.strokeCentered ? ['centered'] : []),
    ...(story.strokeInset ? ['inset'] : []),
    ...(story.fitHeightToText ? ['fit'] : []),
    ...(story.strokeDash ? ['dash', story.strokeDash.join(' ')] : []),
    ...(story.strokeCap ? ['cap', story.strokeCap] : []),
    ...(story.shadow ? ['shadow', JSON.stringify(story.shadow)] : []),
    ...(story.drawingText ? ['drawing-text'] : []),
  ]);
}
