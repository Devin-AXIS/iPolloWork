/**
 * Assembly of the collected context entries into injected context blocks that
 * ride along with the triggering prompt.
 *
 * Each entry becomes one `<dsh_im_context>` block of the shared injected
 * context grammar, so the Host's `agent/pre-step` listener splits every entry
 * back out into its own plugin-sourced context message beside the untouched
 * user text: what the human asked stays exactly what the human typed, and the
 * collected material is separated by `source`, never spliced into the question.
 * Entries sharing one event id merge into a single block whose `collector`
 * names every role that hit the event (e.g. `thread-root+reply`), so the same
 * message is never presented twice under two headings.
 */

import { INJECTED_CONTEXT_SEPARATOR, INJECTED_CONTEXT_TAGS } from '../context-enhancement.mjs';
import { CONTEXT_NOTE } from '../injected-context.mjs';

/**
 * @typedef {Object} ContextEntry
 * @property {'thread-root'|'reply'|'ambient-burst'|'ambient-recent'|string} collector
 * @property {string} roomId
 * @property {?string} eventId
 * @property {?string} sender
 * @property {?string} name
 * @property {?number} ts
 * @property {string} text
 */

const COLLECTOR_MAX = 64;
const ROOM_MAX = 256;
const EVENT_MAX = 256;
const SENDER_MAX = 300;
const CONTENT_MAX = 8_000;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/gu;

function cleanField(value, limit) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARACTERS, '').trim();
  if (!cleaned) return undefined;
  return cleaned.length <= limit ? cleaned : cleaned.slice(0, limit);
}

function cleanContent(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\r\n?/gu, '\n').replace(CONTROL_CHARACTERS, '');
  if (!normalized.trim()) return undefined;
  return normalized.length <= CONTENT_MAX ? normalized : normalized.slice(0, CONTENT_MAX);
}

/**
 * Merge entries that point at the same event into one entry, keeping the first
 * occurrence's position, room, sender and stamp and naming every collector that
 * referenced the event in first-seen order. Entries without an event id pass
 * through unmerged; their collected text alone is what identifies them.
 *
 * @param {ContextEntry[]} entries
 * @returns {ContextEntry[]} merged entries in assembly order
 */
export function dedupeContextEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const merged = [];
  const byEvent = new Map();
  for (const entry of entries) {
    const eventId = cleanField(entry?.eventId, EVENT_MAX);
    if (eventId === undefined) {
      merged.push({ ...entry });
      continue;
    }
    const existing = byEvent.get(eventId);
    if (existing === undefined) {
      const copy = { ...entry, collector: cleanField(entry?.collector, COLLECTOR_MAX) ?? '' };
      byEvent.set(eventId, copy);
      merged.push(copy);
      continue;
    }
    const collector = cleanField(entry?.collector, COLLECTOR_MAX);
    if (collector !== undefined) {
      existing.collector = existing.collector ? `${existing.collector}+${collector}` : collector;
    }
  }
  return merged;
}

/**
 * Render one entry as a well-formed injected context block. The body is a
 * plain object drawn from the block schema with `<>&` escaped, so the closing
 * tag cannot be forged from collected values and the Host recognizes exactly
 * the blocks this producer wrote.
 *
 * @param {ContextEntry} entry
 * @returns {string} the block, or '' when the entry carries no renderable content.
 */
export function contextBlockFor(entry) {
  const content = cleanContent(entry?.text);
  if (content === undefined) return '';
  const body = {
    note: CONTEXT_NOTE,
    collector: cleanField(entry?.collector, COLLECTOR_MAX) ?? '?',
    ...(cleanField(entry?.roomId, ROOM_MAX) !== undefined ? { room: cleanField(entry.roomId, ROOM_MAX) } : {}),
    ...(cleanField(entry?.eventId, EVENT_MAX) !== undefined ? { event: cleanField(entry.eventId, EVENT_MAX) } : {}),
    ...(() => {
      const sender = cleanField(entry?.sender ?? entry?.name, SENDER_MAX);
      return sender === undefined ? {} : { sender };
    })(),
    ...(Number.isSafeInteger(entry?.ts) && entry.ts > 0 ? { ts: entry.ts } : {}),
    content,
  };
  const json = JSON.stringify(body).replace(/[<>&]/gu, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
  })[character]);
  return `${INJECTED_CONTEXT_TAGS.contextOpen}${json}${INJECTED_CONTEXT_TAGS.contextClose}`;
}

/**
 * Render the whole block set: entries merge by event id, empty entries drop
 * out, and the surviving blocks join in the order the collectors supplied
 * (explicit collectors before ambient). Joined with the protocol separator the
 * Host's splitter consumes, so the user text that follows is all the human
 * actually wrote.
 *
 * @param {ContextEntry[]} entries
 * @returns {string} the joined blocks, or '' when there is nothing to say.
 */
export function renderContextEntries(entries) {
  const blocks = [];
  for (const entry of dedupeContextEntries(entries)) {
    const block = contextBlockFor(entry);
    if (block) blocks.push(block);
  }
  return blocks.join(INJECTED_CONTEXT_SEPARATOR);
}

/**
 * Prepend the rendered blocks to the triggering prompt text, mirroring the
 * enhancement producer's prefix pattern exactly so the splitter consumes the
 * blocks and leaves the question verbatim.
 *
 * @param {{block: string, promptText: ?string}} parts
 * @returns {string}
 */
export function composeContextPrompt({ block, promptText } = {}) {
  const text = typeof promptText === 'string' ? promptText : '';
  if (typeof block !== 'string' || !block) return text;
  return `${block}\n\n${text}`;
}
