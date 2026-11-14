const DEFAULT_MAX_TITLE_BYTES = 60;

const OSC_SEQUENCE = /(?:\u001b\]|\u009d)(?:(?!\u0007|\u001b\\)[\s\S])*(?:\u0007|\u001b\\|$)/gu;
const CSI_SEQUENCE = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu;
const ESC_SEQUENCE = /\u001b[@-_]/gu;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const DIRECTIONAL_CONTROL = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/gu;
const INJECTED_CONTEXT_PREFIX = /^(?:<dsh_im_source>[\s\S]*?<\/dsh_im_source>\s*)?(?:<dsh_im_source_guidance>[\s\S]*?<\/dsh_im_source_guidance>\s*)?(?:<dsh_im_reply_to>[\s\S]*?<\/dsh_im_reply_to>\s*)?/u;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function cleanTitleText(input) {
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function truncateTitle(input, maxBytes = DEFAULT_MAX_TITLE_BYTES) {
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input;
  const suffix = '…';
  const budget = maxBytes - Buffer.byteLength(suffix, 'utf8');
  let output = '';
  for (const { segment } of SEGMENTER.segment(input)) {
    if (Buffer.byteLength(output + segment, 'utf8') > budget) break;
    output += segment;
  }
  return `${output.trimEnd()}${suffix}`;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function fileDisplayName(file) {
  const value = file?.name ?? file?.filename ?? file?.fileName;
  if (typeof value !== 'string') return '';
  return value
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim() ?? '';
}

/** Build a deterministic title from the unenhanced first user message. */
export function initialSessionTitle({ text, content, files } = {}) {
  const original = typeof text === 'string' ? cleanTitleText(text) : '';
  if (original) return truncateTitle(original);

  // Structured image prompts may only expose their default text through content.
  // Strip only the leading blocks inserted by dsh-im; matching tags later in user
  // content remain ordinary user text.
  const visibleContent = cleanTitleText(
    contentText(content).replace(INJECTED_CONTEXT_PREFIX, ''),
  );
  if (visibleContent) return truncateTitle(visibleContent);

  const fileName = Array.isArray(files)
    ? files.map(fileDisplayName).find(Boolean)
    : '';
  const cleanFileName = fileName ? cleanTitleText(fileName) : '';
  return cleanFileName ? truncateTitle(cleanFileName) : null;
}

export const INITIAL_SESSION_TITLE_MAX_BYTES = DEFAULT_MAX_TITLE_BYTES;

/**
 * Normalize a user-supplied inline title (e.g. `/new <title>`): strip control
 * characters, collapse whitespace, trim, and truncate to the session-title byte
 * budget. Returns null when nothing usable remains.
 */
export function normalizeSessionTitle(text) {
  if (typeof text !== 'string') return null;
  const cleaned = cleanTitleText(text);
  return cleaned ? truncateTitle(cleaned, DEFAULT_MAX_TITLE_BYTES) : null;
}
