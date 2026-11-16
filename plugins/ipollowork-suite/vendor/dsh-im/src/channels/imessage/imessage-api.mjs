import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_DB_PATH = `${process.env.HOME ?? ''}/Library/Messages/chat.db`;
const DEFAULT_TIMEOUT_MS = 15_000;
// Self-chat has no separate bot sender. Keep the reply marker in Messages itself
// so echoes are still recognizable after a Host restart or iCloud resync.
export const IMESSAGE_BOT_REPLY_PREFIX = '🤖 DSH\n';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeChatGuid(value) {
  const chatGuid = cleanString(value?.chatGuid ?? value);
  if (!chatGuid || chatGuid.length > 512 || /[\r\n]/.test(chatGuid)) {
    throw new TypeError('iMessage chatGuid is required');
  }
  return chatGuid;
}

function normalizeAddress(value) {
  const address = cleanString(value);
  if (!address || address.length > 512 || /[\r\n]/.test(address)) {
    throw new TypeError('iMessage address is required');
  }
  return address;
}

function permissionError(kind, message, cause) {
  const error = new Error(message, { cause });
  error.code = kind;
  return error;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function decodeRows(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return [];
  try {
    const rows = JSON.parse(text);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    throw new Error('macOS Messages returned invalid database output', { cause: error });
  }
}

function appleScriptString(value) {
  return JSON.stringify(String(value));
}

// macOS 26 (Tahoe) stopped populating message.text for received iMessages: the
// body is only stored in message.attributedBody, an NSArchiver typedstream blob
// (`streamtyped` + archived NSAttributedString). These constants describe the
// inline-string run we need to read from that archive.
const ATTRIBUTED_BODY_STRING_CLASS = Buffer.from('NSString', 'utf8');
const ATTRIBUTED_BODY_STRING_TAG = 0x2b; // '+': inline NSString payload follows
// Attachment-only messages carry U+FFFC (object replacement character) instead
// of text. The channel is text-only, so such runs must keep normalizing to null.
const OBJECT_REPLACEMENT_CHARACTER = '\ufffc';

// Apple NXTypedStream integer encoding: a signed byte is a literal length,
// 0x81/0x82/0x83 introduce a little-endian 2/4/8-byte length.
function readTypedStreamLength(buffer, offset) {
  if (offset >= buffer.length) return null;
  const tag = buffer[offset];
  let cursor = offset + 1;
  let length;
  if (tag === 0x81) {
    if (cursor + 2 > buffer.length) return null;
    length = buffer.readInt16LE(cursor);
    cursor += 2;
  } else if (tag === 0x82) {
    if (cursor + 4 > buffer.length) return null;
    length = buffer.readInt32LE(cursor);
    cursor += 4;
  } else if (tag === 0x83) {
    if (cursor + 8 > buffer.length) return null;
    const value = buffer.readBigInt64LE(cursor);
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    length = Number(value);
    cursor += 8;
  } else {
    length = tag > 0x7f ? tag - 0x100 : tag;
  }
  if (!Number.isInteger(length) || length < 0 || cursor + length > buffer.length) return null;
  return { length, offset: cursor };
}

// Accepts either the hex string selected via hex(m.attributedBody) or the raw blob.
export function decodeAttributedBodyText(value) {
  const buffer = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string' && value.trim() ? Buffer.from(value.trim(), 'hex') : null;
  if (!buffer?.length) return null;
  const marker = buffer.indexOf(ATTRIBUTED_BODY_STRING_CLASS);
  if (marker < 0) return null;
  let tagIndex = marker + ATTRIBUTED_BODY_STRING_CLASS.length;
  while (tagIndex < buffer.length && buffer[tagIndex] !== ATTRIBUTED_BODY_STRING_TAG) tagIndex += 1;
  if (tagIndex >= buffer.length) return null;
  const run = readTypedStreamLength(buffer, tagIndex + 1);
  if (!run || run.length === 0) return null;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(run.offset, run.offset + run.length));
  } catch {
    return null;
  }
  const stripped = text.replaceAll(OBJECT_REPLACEMENT_CHARACTER, '').trim();
  return stripped || null;
}

export function normalizeIMessageTarget(value) {
  return normalizeChatGuid(value);
}

export function normalizeIMessage(value, { botId } = {}) {
  if (!value || typeof value !== 'object') return null;
  if (value.serviceName !== undefined && value.serviceName !== 'iMessage') return null;
  const guid = cleanString(value.guid ?? value.id);
  const chatGuid = cleanString(value.chatGuid ?? value.chat_guid);
  const text = cleanString(value.text)
    ?? decodeAttributedBodyText(value.attributedBodyHex ?? value.attributedBody);
  const sender = cleanString(value.sender ?? value.handle_id);
  if (!guid || !chatGuid || !text || !sender) return null;
  if (text.startsWith(IMESSAGE_BOT_REPLY_PREFIX)) return null;
  if (value.isFromMe === 1 || value.isFromMe === true) return null;
  if (botId && sender === botId) return null;
  return Object.freeze({
    messageId: guid,
    providerMessageId: guid,
    conversationId: chatGuid,
    kind: 'direct',
    senderId: sender,
    senderName: sender,
    content: text,
    addressed: true,
    replyTarget: { chatGuid, address: sender, serviceName: 'iMessage' },
    connectionTestTarget: { chatGuid, address: sender, serviceName: 'iMessage' },
    ...(value.receivedAt ? { receivedAt: value.receivedAt } : {}),
  });
}

export class MacOSMessagesApi {
  #dbPath;
  #execFile;
  #execFileOptions;
  #osascript;

  constructor({ dbPath = DEFAULT_DB_PATH, execFileImpl = execFileAsync, osascriptImpl } = {}) {
    this.#dbPath = dbPath;
    this.#execFile = execFileImpl;
    this.#execFileOptions = { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 };
    this.#osascript = osascriptImpl ?? ((script) => this.#execFile('/usr/bin/osascript', ['-e', script], this.#execFileOptions));
    if (typeof this.#execFile !== 'function' || typeof this.#osascript !== 'function') {
      throw new TypeError('MacOSMessagesApi requires command runners');
    }
  }

  async getPermissions() {
    const result = { platform: process.platform, database: 'unknown', automation: 'unknown' };
    if (process.platform !== 'darwin') {
      return { ...result, database: 'unsupported', automation: 'unsupported' };
    }
    try {
      await this.#execFile('/usr/bin/sqlite3', ['-json', this.#dbPath, 'SELECT 1 AS ok LIMIT 1;'], this.#execFileOptions);
      result.database = 'granted';
    } catch (error) {
      result.database = /authorization denied|not authorized|unable to open database/i.test(String(error?.stderr ?? error))
        ? 'required' : 'error';
    }
    try {
      await this.#osascript('tell application "Messages" to get name');
      result.automation = 'granted';
    } catch (error) {
      result.automation = /not authorized|(-1743)|assistive/i.test(String(error?.stderr ?? error))
        ? 'required' : 'error';
    }
    return result;
  }

  async listMessages({ after = 0, limit = 50, chatGuid } = {}) {
    const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const chatFilter = chatGuid ? ` AND c.guid = ${sqlString(normalizeChatGuid(chatGuid))}` : '';
    // Messages delivers self-chat back as an incoming copy. Read that copy once,
    // keeping all outgoing rows excluded, and filter bot replies by their marker.
    // macOS 26 (Tahoe) stores received iMessage bodies only in attributedBody, so
    // accept either text column and decode the blob when text is empty.
    const query = `SELECT m.ROWID AS rowid, m.guid AS guid, m.text AS text,
      hex(m.attributedBody) AS attributedBodyHex,
      h.id AS sender, c.guid AS chatGuid, c.service_name AS serviceName,
      m.is_from_me AS isFromMe,
      datetime((m.date / 1000000000) + 978307200, 'unixepoch') AS receivedAt
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID > ${cursor} AND m.is_from_me = 0
        AND ((m.text IS NOT NULL AND m.text != '') OR m.attributedBody IS NOT NULL)
        AND c.service_name = 'iMessage'${chatFilter}
      ORDER BY m.ROWID ASC LIMIT ${boundedLimit};`;
    try {
      const { stdout } = await this.#execFile('/usr/bin/sqlite3', ['-json', this.#dbPath, query], this.#execFileOptions);
      return decodeRows(stdout);
    } catch (error) {
      if (/authorization denied|not authorized|unable to open database/i.test(String(error?.stderr ?? error))) {
        throw permissionError('messages-database-permission-required', '请在系统设置中授予 DeepSeek Harness 完全磁盘访问权限。', error);
      }
      throw error;
    }
  }

  async getLatestMessageRowId() {
    if (process.platform !== 'darwin') return 0;
    const query = `SELECT COALESCE(MAX(m.ROWID), 0) AS rowid
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.service_name = 'iMessage';`;
    const { stdout } = await this.#execFile(
      '/usr/bin/sqlite3', ['-json', this.#dbPath, query], this.#execFileOptions,
    );
    const rows = decodeRows(stdout);
    const rowid = Number(rows[0]?.rowid ?? 0);
    return Number.isSafeInteger(rowid) && rowid >= 0 ? rowid : 0;
  }

  async sendText({ chatGuid, address, text } = {}) {
    const target = normalizeChatGuid(chatGuid);
    const recipient = address ? normalizeAddress(address) : target.split(';').at(-1) || target;
    const content = cleanString(text);
    if (!content) throw new TypeError('iMessage text is required');
    const reply = content.startsWith(IMESSAGE_BOT_REPLY_PREFIX)
      ? content : `${IMESSAGE_BOT_REPLY_PREFIX}${content}`;
    const script = `tell application "Messages"
      set serviceList to every service whose service type = iMessage
      if (count of serviceList) is 0 then error "No iMessage service is available"
      set targetService to item 1 of serviceList
      set targetBuddy to buddy ${appleScriptString(recipient)} of targetService
      send ${appleScriptString(reply)} to targetBuddy
    end tell`;
    try {
      await this.#osascript(script);
      return { sent: true };
    } catch (error) {
      if (/not authorized|(-1743)|assistive/i.test(String(error?.stderr ?? error))) {
        throw permissionError('messages-automation-permission-required', '请在系统设置中允许 DeepSeek Harness 自动化控制 Messages。', error);
      }
      throw error;
    }
  }
}

export { DEFAULT_DB_PATH };
