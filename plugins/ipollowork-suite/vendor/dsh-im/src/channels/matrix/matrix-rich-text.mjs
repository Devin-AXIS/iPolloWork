/**
 * Matrix-side rich-text construction and pure event-content builders.
 *
 * The harness replies with Markdown or plain text. Matrix clients render
 * `formatted_body` when the format is recognized, so this module produces the
 * sanitized HTML projection plus the always-present plain `body` fallback,
 * injects MXID pills outside code regions, and builds the relation events for
 * replies, threads, edits and reactions exactly once per message pipeline.
 */

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'matrix:', 'mailto:']);

const ALLOWED_TAGS = Object.freeze({
  br: [], b: [], strong: [], i: [], em: [], u: [], del: [], s: [],
  code: ['class'], pre: [], blockquote: [], ul: [], ol: [], li: [],
  a: ['href'], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  table: [], thead: [], tbody: [], tr: [], th: [], td: [],
  p: [], hr: [], details: [], summary: [], span: ['data-mx-id', 'data-mx-pill'],
});

const TAG_PATTERN = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\s*(\/?)\s*>/g;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function escapeMatrixHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeMatrixUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /[\u0000-\u0020\u007f]/u.test(raw)) return null;
  if (raw.startsWith('#') || raw.startsWith('/')) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Relative and scheme-less links stay visible as plain text instead of
    // becoming dead anchors; Matrix clients cannot resolve them anyway.
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(raw)) return raw;
    return null;
  }
  return SAFE_URL_SCHEMES.has(url.protocol) ? url.href : null;
}

function decodeAttributeEntities(value) {
  return String(value ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll(/&#(\d{1,7});/gu, (match) => String.fromCodePoint(Number(match.slice(2, -1))))
    .replaceAll(/&#x([0-9A-Fa-f]{1,6});/gu, (match) => String.fromCodePoint(Number(`0x${match.slice(3, -1)}`)))
    .replaceAll('&amp;', '&');
}

function sanitizeAttributes(tag, attributeText) {
  const allowed = ALLOWED_TAGS[tag] ?? [];
  if (allowed.length === 0 || !attributeText.trim()) return '';
  const kept = [];
  for (const match of attributeText.matchAll(ATTRIBUTE_PATTERN)) {
    const name = String(match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!allowed.includes(name)) continue;
    if (name === 'href') {
      const safe = safeMatrixUrl(decodeAttributeEntities(value));
      if (safe) kept.push(`href="${escapeMatrixHtml(safe)}"`);
      continue;
    }
    if (name === 'class') {
      if (/^language-[A-Za-z0-9+-]{1,64}$/.test(value)) kept.push(`class="${escapeMatrixHtml(value)}"`);
      continue;
    }
    kept.push(`${name}="${escapeMatrixHtml(value)}"`);
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
}

/**
 * Whitelist-only HTML sanitizer for outbound `formatted_body`. Unknown tags are
 * dropped while their text content survives; `on*` attributes, inline event
 * handlers and `javascript:`/`data:` schemes never survive the attribute pass.
 */
export function sanitizeMatrixHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const stripped = html
    .replaceAll(/<\s*(script|style|iframe|form|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replaceAll(/<\s*(script|style|iframe|form|object|embed)\b[^>]*\/?\s*>/gi, '');
  return stripped.replaceAll(TAG_PATTERN, (whole, closing, rawTag, attributes, selfClose) => {
    const tag = rawTag.toLowerCase();
    if (!Object.hasOwn(ALLOWED_TAGS, tag)) return '';
    if (closing) return selfClose ? '' : `</${tag}>`;
    const attribute = sanitizeAttributes(tag, attributes ?? '');
    const selfClosing = selfClose && (tag === 'br' || tag === 'hr' || tag === 'img') ? ' /' : '';
    return `<${tag}${attribute}${selfClosing}>`;
  });
}

function inlineMatrixPass(escaped) {
  const codeStash = [];
  const stash = (html) => {
    codeStash.push(html);
    return `\u0000${codeStash.length - 1}\u0000`;
  };
  let text = escaped.replace(/`([^`\n]+)`/g, (_whole, inner) => stash(`<code>${inner}</code>`));
  text = text.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_whole, a, b) => `<strong>${a ?? b}</strong>`);
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_whole, lead, inner) => `${lead}<em>${inner}</em>`);
  text = text.replace(/~~([^~\n]+)~~/g, (_whole, inner) => `<del>${inner}</del>`);
  text = text.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_whole, label, target) => {
    const safe = safeMatrixUrl(target.replaceAll(/&amp;/g, '&'));
    if (!safe) return `${label} (${target})`;
    return stash(`<a href="${escapeMatrixHtml(safe)}">${label}</a>`);
  });
  text = text.replace(/\u0000(\d+)\u0000/g, (_whole, index) => codeStash[Number(index)] ?? '');
  return text;
}

/**
 * Deterministic Markdown subset for Matrix rendering: fenced and inline code,
 * bold/italic/strikethrough, links, ATX headings, bullet and ordered lists,
 * blockquotes, thematic breaks and hard line breaks. Everything else stays
 * literal text, so tables keep readable prose instead of collapsing.
 */
export function markdownToMatrixHtml(text) {
  const source = String(text ?? '');
  if (!source) return '';
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  let fence = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map((line) => inlineMatrixPass(escapeMatrixHtml(line))).join('<br/>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item) => `<li>${inlineMatrixPass(escapeMatrixHtml(item))}</li>`).join('');
    blocks.push(list.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(`<blockquote>${quote.map((line) => inlineMatrixPass(escapeMatrixHtml(line))).join('<br/>')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9+._-]*)\s*$/.exec(line);
    if (fence && line.trim().endsWith(fence.marker) && line.trim().length >= fence.marker.length) {
      blocks.push(`<pre><code class="language-${escapeMatrixHtml(fence.lang || 'plain')}">${
        escapeMatrixHtml(fence.body.join('\n'))
      }</code></pre>`);
      fence = null;
      continue;
    }
    if (fence) {
      fence.body.push(line);
      continue;
    }
    if (fenceMatch) {
      flushAll();
      fence = { marker: fenceMatch[1], lang: fenceMatch[2] ?? '', body: [] };
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push(`<p><strong>${inlineMatrixPass(escapeMatrixHtml(heading[2].trim()))}</strong></p>`);
      continue;
    }
    if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      flushAll();
      blocks.push('<hr/>');
      continue;
    }
    const quoteMatch = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }
    flushQuote();
    const bullet = /^\s*[-+*]\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const orderedItem = ordered ? ordered[2] : bullet[1];
      if (!list || list.ordered !== Boolean(ordered)) {
        flushList();
        list = { ordered: Boolean(ordered), items: [] };
      }
      list.items.push(orderedItem);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line);
  }
  if (fence) {
    blocks.push(`<pre><code class="language-${escapeMatrixHtml(fence.lang || 'plain')}">${
      escapeMatrixHtml(fence.body.join('\n'))
    }</code></pre>`);
  }
  flushAll();
  return blocks.join('\n');
}

function protectCodeRegions(text) {
  const stash = [];
  const protectedText = text
    .replaceAll(/```[\s\S]*?```/g, (whole) => {
      stash.push(whole);
      return `\u0001${stash.length - 1}\u0001`;
    })
    .replaceAll(/`[^`\n]+`/g, (whole) => {
      stash.push(whole);
      return `\u0001${stash.length - 1}\u0001`;
    });
  return { protectedText, stash };
}

function restoreCodeRegions(text, stash) {
  return text.replaceAll(/\u0001(\d+)\u0001/g, (_whole, index) => stash[Number(index)] ?? '');
}

const OUTBOUND_MENTION_PATTERN = /(^|[\s(])@([A-Za-z0-9._=\-\/+]+):([A-Za-z0-9.-]+(?::\d{1,5})?)/g;

/** Collect the full MXIDs an outbound message mentions for `m.mentions`. */
export function extractOutboundMentions(text) {
  const mentions = [];
  const { protectedText } = protectCodeRegions(String(text ?? ''));
  for (const match of protectedText.matchAll(OUTBOUND_MENTION_PATTERN)) {
    mentions.push(`@${match[2]}:${match[3]}`);
  }
  return [...new Set(mentions)];
}

export function hasRoomMention(text) {
  const { protectedText } = protectCodeRegions(String(text ?? ''));
  return /(^|[\s(])@(room|all)\b/u.test(protectedText);
}

/**
 * Wrap full MXIDs outside code regions into Matrix pill links so Element-style
 * clients render them as chips; `m.mentions` still carries the notification set.
 */
export function injectOutboundMentionPills(text) {
  const { protectedText, stash } = protectCodeRegions(String(text ?? ''));
  const pillText = protectedText.replaceAll(
    OUTBOUND_MENTION_PATTERN,
    (_whole, lead, localpart, server) => `${lead}[<@${localpart}:${server}>](https://matrix.to/#/@${localpart}:${server})`,
  );
  return restoreCodeRegions(pillText, stash);
}

export function buildMatrixTextContent({ text, mentionUserIds = [], roomMention = false } = {}) {
  const body = String(text ?? '');
  const html = sanitizeMatrixHtml(markdownToMatrixHtml(injectOutboundMentionPills(body)));
  const hasHtml = Boolean(html) && html !== escapeMatrixHtml(body).replaceAll(/\n/g, '<br/>');
  const content = { msgtype: 'm.text', body };
  if (hasHtml) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = html;
  }
  const user_ids = [...new Set(mentionUserIds)];
  if (user_ids.length || roomMention) content['m.mentions'] = { user_ids, 'm.room': roomMention };
  return content;
}

export function buildMatrixEditContent({ originalContent, newText, eventId } = {}) {
  const edited = buildMatrixTextContent({ text: newText, mentionUserIds: originalContent?.['m.mentions']?.user_ids ?? [] });
  const content = { ...originalContent, ...edited, body: `* ${edited.body}` };
  if (edited.formatted_body) content.formatted_body = `* ${edited.formatted_body}`;
  content['m.new_content'] = edited;
  content['m.relates_to'] = { event_id: eventId, rel_type: 'm.replace' };
  return content;
}

export function buildMatrixReactionContent(eventId, key) {
  return { 'm.relates_to': { event_id: eventId, rel_type: 'm.annotation' }, 'm.reaction': key };
}

export function applyMatrixRelations(content, { threadId, replyToEventId } = {}) {
  if (replyToEventId && !threadId) {
    content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyToEventId }, is_falling_back: false };
    return content;
  }
  if (threadId) {
    content['m.relates_to'] = {
      event_id: threadId,
      rel_type: 'm.thread',
      is_falling_back: true,
      'm.in_reply_to': { event_id: replyToEventId ?? threadId },
    };
  }
  return content;
}
