import { parseSessionChannelTitle } from '../../src/channels/shared/session-channel-labels.mjs';
import {
  WeixinLogoGlyph, FeishuLogoGlyph, DingtalkLogoGlyph, WecomLogoGlyph, QqLogoGlyph,
  SlackLogoGlyph, TelegramLogoGlyph, DiscordLogoGlyph, WhatsappLogoGlyph, OfficeLogoGlyph,
  IMessageLogoGlyph, MatrixLogoGlyph,
} from './channel-logos.js';

const GLYPHS = Object.freeze({
  weixin: [WeixinLogoGlyph, '#07c160'],
  feishu: [FeishuLogoGlyph, '#3370ff'],
  dingtalk: [DingtalkLogoGlyph, '#1677ff'],
  wecom: [WecomLogoGlyph, '#3370ff'],
  qq: [QqLogoGlyph, '#12b7f5'],
  slack: [SlackLogoGlyph, '#e01e5a'],
  telegram: [TelegramLogoGlyph, '#229ed9'],
  discord: [DiscordLogoGlyph, '#5865f2'],
  whatsapp: [WhatsappLogoGlyph, '#25d366'],
  imessage: [IMessageLogoGlyph, '#3478f6'],
  matrix: [MatrixLogoGlyph, '#1a8f6f'],
  office: [OfficeLogoGlyph, '#f97316'],
});
const CHANNEL_ATTR = 'data-dsh-im-session-channel';
const TITLE_ATTR = 'data-dsh-im-session-text';
const MARKED = `[${CHANNEL_ATTR}]`;
const ROW = '[role="treeitem"][aria-selected]';
const SVG_NS = 'http://www.w3.org/2000/svg';
const installations = new WeakMap();

function hasClassPart(element, part) {
  return [...element.classList].some((token) => token.split(/[_-]/u).includes(part));
}

function titleOf(row) {
  if (!row.matches(ROW) || row.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return null;
  let title;
  if (row.tagName === 'DIV' && hasClassPart(row, 'sessionRow')) {
    title = [...row.children].find((child) => child.tagName === 'SPAN' && hasClassPart(child, 'title'));
  } else if (row.tagName === 'BUTTON' && hasClassPart(row, 'searchResultRow')) {
    const heading = [...row.children].find((child) => hasClassPart(child, 'searchResultHeading'));
    title = heading && [...heading.children].find((child) => child.tagName === 'SPAN' && hasClassPart(child, 'searchResultTitle'));
  }
  // Never cover inline rename inputs, highlighted search markup, or a future
  // row structure that this adapter does not understand.
  return title?.childNodes.length === 1 && title.firstChild.nodeType === 3 ? title : null;
}

/** Serialize the existing, static SVG glyphs without mounting React nodes. */
function logoUri(document, channel) {
  const [Glyph, color] = GLYPHS[channel];
  const render = (node) => {
    if (!['svg', 'path'].includes(node.type)) throw new Error('Unsupported channel logo element');
    const element = document.createElementNS(SVG_NS, node.type);
    for (const [name, value] of Object.entries(node.props)) {
      if (name === 'children') continue;
      const attribute = name.startsWith('stroke')
        ? name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
        : name;
      element.setAttribute(attribute, String(value));
    }
    for (const child of [node.props.children].flat().filter(Boolean)) element.appendChild(render(child));
    return element;
  };
  const svg = render(Glyph({ size: 16 }));
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('color', color);
  return `data:image/svg+xml,${encodeURIComponent(svg.outerHTML)}`;
}

function createInstallation(document) {
  const view = document.defaultView;
  const ready = new Set();
  const owned = new Map();
  const queued = new Set();
  const images = [];
  let closed = false;
  let scheduled = false;
  const style = document.createElement('style');
  style.dataset.pluginCss = 'dsh-im-session-channel-logos';
  const uris = Object.fromEntries(Object.keys(GLYPHS).map((channel) => [channel, logoUri(document, channel)]));
  style.textContent = `
${MARKED}[${TITLE_ATTR}] {
  position: relative;
  -webkit-text-fill-color: transparent;
  text-overflow: clip !important;
  overflow: hidden;
}
${MARKED}[${TITLE_ATTR}]::before {
  content: "";
  position: absolute;
  inset-inline-start: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  background: var(--dsh-im-session-logo) center / contain no-repeat;
  text-indent: 0;
  pointer-events: none;
}
${MARKED}[${TITLE_ATTR}]::after {
  content: attr(${TITLE_ATTR}) / "";
  position: absolute;
  inset: 0;
  inset-inline-start: 22px;
  -webkit-text-fill-color: currentColor;
  text-indent: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}
/* The Host scrolls the original span and publishes these marquee fade hooks.
   Let the replacement travel as complete text, not a pre-clipped viewport. */
${MARKED}[${TITLE_ATTR}]:is([data-scrolled], [data-clipped])::after {
  inset-inline-end: auto;
  width: max-content;
  overflow: visible;
  text-overflow: clip;
}
${Object.entries(uris).map(([channel, uri]) => `[${CHANNEL_ATTR}="${channel}"] { --dsh-im-session-logo: url("${uri}"); }`).join('\n')}
`;
  document.head.appendChild(style);

  const restore = (title) => {
    const previous = owned.get(title);
    if (!previous) return;
    owned.delete(title);
    for (const [attribute, value] of previous) {
      if (value === null) title.removeAttribute(attribute);
      else title.setAttribute(attribute, value);
    }
  };
  const update = (row) => {
    const title = row.isConnected ? titleOf(row) : null;
    for (const marked of row.querySelectorAll(MARKED)) {
      if (marked !== title) restore(marked);
    }
    if (!title) return;
    const parsed = parseSessionChannelTitle(title.textContent);
    if (!parsed || !ready.has(parsed.channel)) {
      restore(title);
      return;
    }
    if (!owned.has(title)) {
      owned.set(title, [CHANNEL_ATTR, TITLE_ATTR].map((attribute) => [attribute, title.getAttribute(attribute)]));
    }
    // React retains its original text node, content, row, and handlers. Only
    // plugin-owned attributes drive the visual replacement via pseudo-elements.
    title.setAttribute(TITLE_ATTR, parsed.title);
    title.setAttribute(CHANNEL_ATTR, parsed.channel);
  };
  const schedule = () => {
    if (closed || scheduled || !queued.size) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (closed) return;
      const rows = [...queued];
      queued.clear();
      for (const row of rows) {
        try {
          update(row);
        } catch {
          for (const marked of row.querySelectorAll(MARKED)) restore(marked);
        }
      }
    });
  };
  const collect = (node, descendants = false) => {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return;
    const row = element.closest(ROW);
    if (row) queued.add(row);
    if (descendants) {
      for (const child of element.querySelectorAll(ROW)) queued.add(child);
      // Also restore an already decorated title moved outside a recognized row.
      const marked = [...element.querySelectorAll(MARKED)];
      if (owned.has(element)) marked.push(element);
      for (const title of marked) {
        const owner = title.closest(ROW);
        if (owner) queued.add(owner);
        else restore(title);
      }
    }
    schedule();
  };
  const observer = new view.MutationObserver((records) => {
    if (closed) return;
    for (const record of records) {
      collect(record.target, record.type === 'attributes');
      if (record.type !== 'childList') continue;
      for (const node of record.addedNodes) collect(node, true);
      for (const node of record.removedNodes) {
        if (node.nodeType !== 1 || node.isConnected) continue;
        if (owned.has(node)) restore(node);
        for (const title of node.querySelectorAll(MARKED)) restore(title);
      }
    }
  });
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'role', 'aria-selected', 'contenteditable'],
  });

  // A CSP or an image-loading failure leaves that channel's readable text
  // prefix in place. No title is hidden until its actual SVG has loaded.
  for (const [channel, uri] of Object.entries(uris)) {
    const image = new view.Image();
    images.push(image);
    image.onload = () => {
      if (closed) return;
      ready.add(channel);
      collect(document.body, true);
    };
    image.src = uri;
  }
  return () => {
    closed = true;
    observer.disconnect();
    queued.clear();
    for (const image of images) image.onload = null;
    for (const title of [...owned.keys()]) restore(title);
    style.remove();
  };
}

/** Browser-only enhancement; unknown/unsupported surfaces keep text prefixes. */
export function installSessionChannelLogos(document = globalThis.document) {
  const view = document?.defaultView;
  if (!document?.body || !document?.head || !view?.MutationObserver || !view?.Image
    || !view.CSS?.supports?.('content', `attr(${TITLE_ATTR}) / ""`)
    || !view.CSS.supports('-webkit-text-fill-color', 'transparent')) return () => {};
  let entry = installations.get(document);
  if (!entry) {
    try {
      entry = { references: 0, close: createInstallation(document) };
    } catch {
      return () => {};
    }
    installations.set(document, entry);
  }
  entry.references += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.references -= 1;
    if (entry.references > 0) return;
    entry.close();
    installations.delete(document);
  };
}
