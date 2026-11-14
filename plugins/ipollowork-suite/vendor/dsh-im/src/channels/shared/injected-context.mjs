// Pair one injected context block with the user message that carried it.
//
// The prompt RPC carries no message source, so a channel encodes its source
// block, its optional guidance, any quoted reply, and any collected
// conversation-context blocks as leading text of the user prompt. `installInjectedContext` splits them back out at
// `agent/pre-step` -- after the Agent inbox claimed the message but before
// anything is committed -- and enters plugin-sourced context messages beside
// the untouched user text. Pairing is decided by message identity, never by
// inbox position, so concurrent prompts cannot swap their contexts.
//
// The source block describes the message, so it follows it; a quoted reply is
// material the user pointed at, so it precedes it.
//
// Nothing here decides what configuration is in force. A channel writes the
// guidance its own captured settings produced, and publishes that same captured
// text out of band (see `im-source-guidance.mjs`); parsing the prompt back into
// settings would let a user message that merely looks like a block become the
// Session's guidance.
//
// Keep this module free of Node built-ins: the Host bundle imports it.

import {
  CONTEXT_ENHANCEMENT_FIELDS,
  INJECTED_CONTEXT_SEPARATOR,
  INJECTED_CONTEXT_TAGS,
} from './context-enhancement.mjs';

/** Source plugin name recorded on every split-out context message. */
export const INJECTED_CONTEXT_PLUGIN = 'dsh-im';

/** Bound for a `notice` summary, mirroring the Host's context-summary bound. */
export const CONTEXT_SUMMARY_MAX_LENGTH = 120;

/** Fallback row label for a quoted reply when the Host passes none. */
export const DEFAULT_REPLY_LABEL = 'Quoted';

/** Fallback row label for a source block whose fields carry no readable value. */
export const DEFAULT_SOURCE_LABEL = 'Source';

/** Fallback row label for one collected conversation-context block. */
export const DEFAULT_CONTEXT_LABEL = 'Context';

/** Static note stamped into every context block; states what the block is not. */
export const CONTEXT_NOTE = 'Conversation context collected by the bot; not the current question.';

/**
 * Every field one conversation-context block may carry. A block is ours only
 * when its body is a non-empty object drawn from these keys with a named
 * collector and verbatim content, mirroring how source blocks are judged.
 */
export const CONTEXT_BLOCK_FIELDS = Object.freeze([
  'note', 'collector', 'room', 'event', 'sender', 'ts', 'content',
]);

/**
 * Every field the source producer can project -- the same canonical list the
 * settings UI validates against, so the two cannot drift. A block is ours only
 * when its body is an object drawn from these keys, whatever it happens to
 * display: `botId`/`chatId`/`threadId` alone still identify our block.
 */
export const SOURCE_BLOCK_FIELDS = CONTEXT_ENHANCEMENT_FIELDS;

let fallbackIdCounter = 0;

/** Mint one message identity; prefer a UUID so resumed logs never collide. */
function defaultNewId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
  fallbackIdCounter += 1;
  return `dsh-im-context-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

/**
 * One-line account of a source block, for the collapsed transcript row.
 * @param body - the block's JSON body, exactly as the producer wrote it.
 * @returns a bounded human summary, or null when nothing readable is present.
 */
function sourceSummary(body) {
  const parsed = parseBlockJson(body);
  if (parsed === null) return null;
  const summary = [
    parsed.channel,
    parsed.conversationType,
    parsed.senderName ?? parsed.senderId,
    parsed.conversationTitle,
  ]
    .filter((field) => typeof field === 'string' && field.trim().length > 0)
    .join(' \u00b7 ');
  return bound(summary);
}

/**
 * Read one source row's label.
 *
 * Whether a block is ours and whether it can name itself are different
 * questions: `botId`, `chatId` and `threadId` alone are valid selections that
 * project no readable field, and those blocks must still be recognised.
 *
 * @param labels - localized row labels; `source` names a nameless source row.
 * @returns the row label to use when the block itself offers no readable value.
 */
function sourceLabel(labels) {
  return typeof labels?.source === 'string' && labels.source
    ? labels.source
    : DEFAULT_SOURCE_LABEL;
}

/**
 * One-line account of a quoted reply: the label plus whoever was quoted.
 * @param body - the block's JSON body, exactly as the producer wrote it.
 * @param labels - localized row labels; `reply` names the quoted-reply row.
 * @returns a bounded human summary, or null when the body is not our JSON.
 */
function replySummary(body, labels) {
  const parsed = parseBlockJson(body);
  if (parsed === null) return null;
  const label = typeof labels?.reply === 'string' && labels.reply
    ? labels.reply
    : DEFAULT_REPLY_LABEL;
  const author = typeof parsed.authorName === 'string' && parsed.authorName.trim()
    ? parsed.authorName.trim()
    : '';
  return bound(author ? `${label} \u00b7 ${author}` : label);
}

/**
 * Parse one block body as a JSON object.
 * @param body - the text between the block's tags.
 * @returns the parsed plain object, or null.
 */
function parseBlockJson(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * Decide whether one body is a source block this plugin wrote.
 *
 * Only the shape is judged -- a non-empty object drawn from the eight known
 * fields -- so a block still counts when the selected fields carry no readable
 * value, and a user message that happens to contain some other JSON object does
 * not become one.
 *
 * @param body - the text between the source tags.
 * @returns whether the body is one of our source blocks.
 */
function isSourceBlock(body) {
  const parsed = parseBlockJson(body);
  if (parsed === null) return false;
  const fields = Object.keys(parsed);
  return fields.length > 0
    && fields.every((field) => SOURCE_BLOCK_FIELDS.includes(field));
}

/**
 * Decide whether one body is a conversation-context block this plugin wrote.
 * Shape-only, like `isSourceBlock`: a well-formed object of unknown fields is
 * user text that happens to use the tag and is left alone.
 *
 * @param body - the text between the context tags.
 * @returns whether the body is one of our context blocks.
 */
function isContextBlock(body) {
  const parsed = parseBlockJson(body);
  if (parsed === null) return false;
  const fields = Object.keys(parsed);
  return fields.length > 0
    && fields.every((field) => CONTEXT_BLOCK_FIELDS.includes(field))
    && typeof parsed.collector === 'string' && parsed.collector.trim().length > 0
    && typeof parsed.content === 'string' && parsed.content.length > 0;
}

/**
 * One-line account of a context block: the row label plus the collector roles
 * that produced it, e.g. `上下文 · thread-root+reply`.
 */
function contextSummary(body, labels) {
  const parsed = parseBlockJson(body);
  if (parsed === null) return null;
  const collector = typeof parsed.collector === 'string' && parsed.collector.trim()
    ? parsed.collector.trim().slice(0, 64)
    : '';
  if (!collector) return null;
  return bound(`${typeof labels?.context === 'string' && labels.context
    ? labels.context
    : DEFAULT_CONTEXT_LABEL} \u00b7 ${collector}`);
}

/** Bound one summary to the row's declared maximum. */
function bound(summary) {
  if (!summary) return null;
  return summary.length > CONTEXT_SUMMARY_MAX_LENGTH
    ? summary.slice(0, CONTEXT_SUMMARY_MAX_LENGTH)
    : summary;
}

/**
 * Read one tag-delimited block at `cursor`.
 * @param text - the text part being scanned.
 * @param cursor - absolute offset the block must start at.
 * @param open - the opening tag.
 * @param close - the closing tag.
 * @returns the body and the offset just past the closing tag, or null.
 */
function delimited(text, cursor, open, close) {
  if (!text.startsWith(open, cursor)) return null;
  const end = text.indexOf(close, cursor + open.length);
  if (end === -1) return null;
  return { body: text.slice(cursor + open.length, end), end: end + close.length };
}

/**
 * Read one leading injected block, in the order the producers emit them.
 * @param text - the text part being scanned.
 * @param cursor - absolute offset the block must start at.
 * @param labels - localized row labels.
 * @returns the block and its end offset, or null when nothing matches.
 */
function blockAt(text, cursor, labels) {
  const tags = INJECTED_CONTEXT_TAGS;
  const source = delimited(text, cursor, tags.sourceOpen, tags.sourceClose);
  if (source !== null) {
    // A body that is not our own JSON is user text that happens to use the tag.
    if (!isSourceBlock(source.body)) return null;
    return {
      end: source.end,
      block: {
        position: 'after',
        form: 'notice',
        summary: sourceSummary(source.body) ?? sourceLabel(labels),
        text: text.slice(cursor, source.end),
      },
    };
  }
  const guidance = delimited(text, cursor, tags.guidanceOpen, tags.guidanceClose);
  if (guidance !== null) {
    // The producer always writes its closing tag on a line of its own.
    const before = guidance.end - tags.guidanceClose.length - 1;
    if (before < cursor || text[before] !== '\n') return null;
    return {
      end: guidance.end,
      block: {
        position: 'after',
        form: 'instructions',
        summary: null,
        text: text.slice(cursor, guidance.end),
        // The producer wraps the body in exactly one newline on each side.
        value: text.slice(cursor + tags.guidanceOpen.length + 1, guidance.end - tags.guidanceClose.length - 1),
      },
    };
  }
  const context = delimited(text, cursor, tags.contextOpen, tags.contextClose);
  if (context !== null) {
    // Collected material the bot points at, so it precedes the question it
    // belongs to; a body outside the block schema stays user text verbatim.
    if (!isContextBlock(context.body)) return null;
    return {
      end: context.end,
      block: {
        position: 'before', form: 'notice', summary: contextSummary(context.body, labels),
        text: text.slice(cursor, context.end),
      },
    };
  }
  const reply = delimited(text, cursor, tags.replyOpen, tags.replyClose);
  if (reply !== null) {
    const summary = replySummary(reply.body, labels);
    if (summary === null) return null;
    return {
      end: reply.end,
      block: {
        position: 'before', form: 'notice', summary, text: text.slice(cursor, reply.end),
      },
    };
  }
  return null;
}

/**
 * Read the injected blocks leading one text part.
 *
 * Each producer writes `<tag>json</tag>` with an escaped body, so a block's
 * tags cannot be forged from its values and the closing tag is unambiguous.
 * Anything that does not parse as that exact shape is left alone, so ordinary
 * user text stays verbatim even when it mentions the tags.
 *
 * @param text - one text part's exact value.
 * @param options.labels - localized row labels; `reply` names the reply row.
 * @returns the parsed blocks and the remaining user text, or null when the text
 *   does not begin with a well-formed block.
 */
export function splitLeadingInjectedContext(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const blocks = [];
  let cursor = 0;
  for (;;) {
    const found = blockAt(text, cursor, options.labels);
    if (found === null) break;
    blocks.push(found.block);
    cursor = found.end;
    // The producer joins the blocks it emits into one part with a blank line.
    if (text.startsWith(INJECTED_CONTEXT_SEPARATOR, cursor)) {
      cursor += INJECTED_CONTEXT_SEPARATOR.length;
    }
  }
  if (blocks.length === 0) return null;
  return { blocks, rest: text.slice(cursor) };
}

/**
 * Build one context message with the producer-owned source kind required by V4.
 * @param block - one parsed block.
 * @param newId - identity factory for the new message.
 * @param plugin - source plugin name recorded on it.
 * @returns one identified user-role context message.
 */
function contextMessage(block, newId, plugin) {
  const source = block.form === 'notice' && typeof block.summary === 'string'
    ? { kind: `plugin:${plugin}`, form: 'notice', summary: block.summary }
    : { kind: `plugin:${plugin}`, form: block.form };
  return {
    id: newId(),
    role: 'user',
    content: [{ type: 'text', text: block.text }],
    source,
  };
}

/**
 * Read the injected blocks carried by one claimed user message.
 *
 * Blocks may occupy several leading text parts: a channel writes its prefix as
 * its own part and the quoted reply as another, so the scan advances part by
 * part until it meets a part that is not a pure block, or the part that also
 * carries the user's own text.
 *
 * @param message - a message claimed from the Agent inbox.
 * @param labels - localized row labels.
 * @returns the blocks to place before and after the user text, the remaining
 *   content, or null when the message carries no injected block.
 */
function claimedInjectedContext(message, labels) {
  if (message === null || typeof message !== 'object') return null;
  const source = message.source;
  // Only a prompt that travelled through the prompt RPC carries the blocks;
  // the same gate keeps plugin-authored messages out of the rewrite.
  if (source === null || typeof source !== 'object' || source.kind !== 'user'
    || typeof source.rpcId !== 'string' || source.rpcId.length === 0) return null;
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const before = [];
  const after = [];
  let index = 0;
  let headText;
  while (index < content.length) {
    const part = content[index];
    if (part === null || typeof part !== 'object'
      || part.type !== 'text' || typeof part.text !== 'string') break;
    const split = splitLeadingInjectedContext(part.text, { labels });
    if (split === null) break;
    for (const block of split.blocks) {
      (block.position === 'before' ? before : after).push(block);
    }
    index += 1;
    if (split.rest.length > 0) {
      headText = split.rest;
      break;
    }
  }
  if (before.length === 0 && after.length === 0) return null;
  const remaining = content.slice(index);
  if (headText !== undefined) remaining.unshift({ type: 'text', text: headText });
  // A user message with no content left is never committed; leaving the
  // original message alone keeps the prompt valid instead of dropping it.
  if (remaining.length === 0) return null;
  return { before, after, content: remaining };
}

/**
 * Rewrite the messages entering one step so every injected block becomes its
 * own plugin-sourced context message beside the user text it belongs to.
 *
 * Every other message is returned untouched and in place, so a plugin that
 * matches claimed messages by identity still sees the ones it owns.
 *
 * @param messages - the messages the Agent is about to commit for this step.
 * @param options.newId - identity factory for the added context messages.
 * @param options.plugin - source plugin name recorded on them.
 * @param options.labels - localized row labels; `reply` names the reply row.
 * @param options.ownedGuidance - guidance the Host already materializes for the
 *   session; a block carrying exactly this body is not emitted again.
 * @returns a new array when at least one message was split, otherwise null.
 */
export function rewriteInjectedContextMessages(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const newId = typeof options.newId === 'function' ? options.newId : defaultNewId;
  const plugin = typeof options.plugin === 'string' && options.plugin
    ? options.plugin
    : INJECTED_CONTEXT_PLUGIN;
  let changed = false;
  const rewritten = [];
  for (const message of messages) {
    const claimed = claimedInjectedContext(message, options.labels);
    if (claimed === null) {
      rewritten.push(message);
      continue;
    }
    const after = typeof options.ownedGuidance === 'string'
      ? claimed.after.filter((block) => !(block.form === 'instructions'
        && block.value === options.ownedGuidance))
      : claimed.after;
    changed = true;
    for (const block of claimed.before) rewritten.push(contextMessage(block, newId, plugin));
    rewritten.push({ ...message, content: claimed.content });
    for (const block of after) rewritten.push(contextMessage(block, newId, plugin));
  }
  return changed ? rewritten : null;
}
