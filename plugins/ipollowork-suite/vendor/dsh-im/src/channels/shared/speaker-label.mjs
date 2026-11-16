/**
 * Speaker labels for room-shared Sessions.
 *
 * A Matrix room routes every addressed message of the room into one shared
 * conversation (see `conversation/route.mjs`: group keys carry no sender), so
 * when several members question the same bot the persisted turn text alone
 * cannot say whose question each turn carries. The bridge therefore labels the
 * model-facing prompt of a group message with the sender's display name; the
 * parsed control text, commands, and ledger keys never pass through here and
 * stay unlabelled.
 */

import { INJECTED_CONTEXT_TAGS } from './context-enhancement.mjs';

/** Tags whose JSON blocks own their provenance and must never absorb a label. */
const BLOCK_OPENS = Object.freeze([
  INJECTED_CONTEXT_TAGS.replyOpen,
  INJECTED_CONTEXT_TAGS.sourceOpen,
  INJECTED_CONTEXT_TAGS.contextOpen,
]);

function isInjectedBlockPart(part) {
  return part?.type === 'text'
    && typeof part.text === 'string'
    && BLOCK_OPENS.some((open) => part.text.startsWith(open));
}

/**
 * Prefix the message body of one model-facing prompt with `speakerName: `.
 * A string prompt is labelled inline; a structured content array is labelled
 * on its first non-block text part so injected reply, source, and context
 * blocks keep their own provenance. With no body text to carry the label — an
 * image-only or reply-only turn — one label part is placed ahead of the media.
 * @param {string|Array<Object>|undefined} content - the assembled prompt content.
 * @param {?string} speakerName - the sender's display name; empty labels are dropped.
 * @returns {string|Array<Object>|undefined} the labelled content, or the input unchanged when no label applies.
 */
export function prependSpeakerLabel(content, speakerName) {
  const name = typeof speakerName === 'string' ? speakerName.trim() : '';
  if (!name) return content;
  if (typeof content === 'string') return content ? `${name}: ${content}` : content;
  if (!Array.isArray(content)) return content;
  const index = content.findIndex((part) => part?.type === 'text' && !isInjectedBlockPart(part));
  if (index === -1) return [{ type: 'text', text: `${name}:` }, ...content];
  return content.with(index, { ...content[index], text: `${name}: ${content[index].text ?? ''}` });
}
