import { fetchFileStream } from '../shared/file-download.mjs';
import { fetchImageBuffer } from '../shared/image-prompt.mjs';
import { t } from '../shared/i18n.mjs';
import { DEFAULT_SEND_LIMIT_PER_MINUTE } from '../shared/send-limit.mjs';

const DEFAULT_BASE_URL = 'https://api.telegram.org/';
const TELEGRAM_FILE_HOSTS = Object.freeze(['api.telegram.org']);
const DEFAULT_FILE_UPLOAD_TIMEOUT_MS = 120_000;

/** Telegram budgets new messages per chat, so the window is not configurable. */
const SEND_WINDOW_MS = 60_000;
/** One original call plus three retries after 429. */
const MAX_SEND_ATTEMPTS = 4;
/** A 429 that asks for more than this is reported instead of waited out. */
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function positiveTimeout(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

/** Resolve after `ms`, or reject as soon as the caller aborts. */
function waitForDelay(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Seconds Telegram asked us to wait, or null when the error is not a 429.
 *
 * Only message-creating calls are retried; a 429 on an edit or a draft means a
 * skipped stream frame, not a lost message.
 */
function rateLimitRetryAfter(error) {
  if (error?.providerCode !== 429 && error?.status !== 429 && error?.code !== 'telegram-429') {
    return null;
  }
  const seconds = Number(error?.retry_after);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 1;
}

function preserveProviderMetadata(target, source) {
  if (source?.providerCode !== undefined) target.providerCode = source.providerCode;
  if (source?.retry_after !== undefined) {
    target.retry_after = source.retry_after;
    target.retryAfter = source.retry_after;
  }
  if (Number.isInteger(source?.status)) target.status = source.status;
  // A wrapped artifact error keeps the attempt history of the call it wraps.
  if (Array.isArray(source?.sendAttempts)) target.sendAttempts = source.sendAttempts;
  return target;
}

/**
 * One record per attempt of a message-creating call.
 *
 * A delivery that ends up unconfirmed may have spent several attempts -- the
 * 2026-10-22 Telegram notice appeared 41 seconds after the incoming message --
 * so the interface status and Telegram's own description are kept for every
 * try, not just the last one the caller finally sees.
 */
function sendAttemptRecord(method, attempt, error) {
  const status = Number(error?.status ?? error?.httpStatus);
  const retryAfter = Number(error?.retry_after);
  return {
    attempt,
    method,
    status: Number.isInteger(status) ? status : null,
    description: typeof error?.message === 'string' && error.message ? error.message : null,
    retry_after: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
  };
}

function withSendAttempts(error, attempts) {
  if (error && typeof error === 'object') error.sendAttempts = attempts;
  return error;
}

function inputRichMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('A Telegram rich message is required');
  }
  const formats = ['markdown', 'html', 'blocks'].filter((key) => value[key] !== undefined);
  if (formats.length !== 1) {
    throw new TypeError('A Telegram rich message requires exactly one format');
  }
  const selected = formats[0];
  if ((selected === 'markdown' || selected === 'html')
    && (typeof value[selected] !== 'string' || !value[selected].trim())) {
    throw new TypeError('Telegram rich message text is invalid');
  }
  if (selected === 'blocks' && !Array.isArray(value.blocks)) {
    throw new TypeError('Telegram rich message blocks are invalid');
  }
  return value;
}

/** Telegram rejects callback_data longer than 64 bytes. */
const CALLBACK_DATA_MAX_BYTES = 64;

/** Validate an inline keyboard so no oversized or malformed payload is dispatched.
 * An empty `inline_keyboard` is accepted: that is how Telegram removes a keyboard.
 */
function inputReplyMarkup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('A Telegram reply markup is required');
  }
  const rows = value.inline_keyboard;
  if (!Array.isArray(rows)) {
    throw new TypeError('Telegram reply markup requires inline_keyboard rows');
  }
  return {
    inline_keyboard: rows.map((row) => {
      if (!Array.isArray(row) || row.length === 0) {
        throw new TypeError('Telegram inline keyboard rows must be non-empty arrays');
      }
      return row.map((button) => {
        const text = cleanString(button?.text);
        if (!text) {
          throw new TypeError('Telegram inline keyboard buttons require text');
        }
        // Bot API 10.3 added `DisabledButton`: a labelled button that does
        // nothing. The spec allows exactly one action field per button, so a
        // disabled button must NOT also carry callback_data — that is why the
        // two are mutually exclusive here instead of simply merged.
        if (button?.disabled !== undefined) {
          if (button.disabled !== null && typeof button.disabled !== 'object') {
            throw new TypeError('Telegram disabled buttons take an empty object');
          }
          if (button.callback_data !== undefined) {
            throw new TypeError(
              'A disabled Telegram button must not carry callback_data',
            );
          }
          return { text, disabled: {} };
        }
        const data = cleanString(button?.callback_data);
        if (!data) {
          throw new TypeError('Telegram inline keyboard buttons require text and callback_data');
        }
        if (Buffer.byteLength(data, 'utf8') > CALLBACK_DATA_MAX_BYTES) {
          throw new TypeError(
            `Telegram callback_data must be at most ${CALLBACK_DATA_MAX_BYTES} bytes`,
          );
        }
        return { text, callback_data: data };
      });
    }),
  };
}

function telegramArtifactProviderError(cause, mediaLabel = 'document') {
  const providerCode = Number(cause?.providerCode);
  const status = Number(cause?.status);
  const message = cleanString(cause?.message) ?? '';
  let code = 'artifact-provider-rejected';
  let summary = `Telegram rejected the ${mediaLabel}.`;
  if (providerCode === 401 || providerCode === 403 || status === 401 || status === 403) {
    code = 'artifact-permission-required';
    summary = `Telegram denied permission to send the ${mediaLabel}.`;
  } else if (providerCode === 413 || status === 413
    || /(?:file|request|entity).{0,20}(?:too (?:big|large)|size limit)|too (?:big|large)/i.test(message)) {
    code = 'artifact-too-large';
    summary = `The ${mediaLabel} exceeds Telegram's size limit.`;
  } else if (providerCode === 429 || status === 429) {
    code = 'artifact-rate-limited';
    summary = `Telegram rate-limited ${mediaLabel} delivery.`;
  } else if (providerCode >= 500 || status >= 500) {
    code = 'artifact-delivery-uncertain';
    summary = `Telegram ${mediaLabel} delivery result is uncertain.`;
  }
  const error = new Error(summary, { cause });
  error.code = code;
  return preserveProviderMetadata(error, cause);
}

function uncertainTelegramDelivery(cause, mediaLabel = 'document') {
  const error = new Error(`Telegram ${mediaLabel} delivery result is uncertain`, { cause });
  error.code = 'artifact-delivery-uncertain';
  return preserveProviderMetadata(error, cause);
}

export function validTelegramToken(value) {
  return typeof value === 'string' && /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

const TELEGRAM_COMMAND_NAME = /^[a-z0-9_]{1,32}$/;

function validBotCommand(value) {
  return Boolean(value)
    && typeof value === 'object' && !Array.isArray(value)
    && typeof value.command === 'string' && TELEGRAM_COMMAND_NAME.test(value.command)
    && typeof value.description === 'string' && value.description.trim().length >= 1
    && [...value.description].length <= 256;
}

export function validateTelegramCommands(commands, { allowEmpty = false } = {}) {
  if (!Array.isArray(commands) || (!allowEmpty && commands.length === 0)
    || commands.length > 100 || commands.some((command) => !validBotCommand(command))
    || new Set(commands.map((item) => item.command)).size !== commands.length) {
    throw new TypeError('Telegram bot commands are invalid');
  }
}

export const COMMANDS_MENU_BUTTON = Object.freeze({ type: 'commands' });

export class TelegramApi {
  #token;
  #fetch;
  #FormDataImpl;
  #baseUrl;
  #fileUploadTimeoutMs;
  #sendLimit;
  #logger;
  // Per chat: timestamps of the messages this bot created in the last window.
  #sendTimestamps = new Map();
  // Per chat: tail of the send queue, so parallel callers share one budget.
  #sendQueue = new Map();

  constructor({
    token,
    fetchImpl = fetch,
    FormDataImpl = globalThis.FormData,
    baseUrl = DEFAULT_BASE_URL,
    fileUploadTimeoutMs = DEFAULT_FILE_UPLOAD_TIMEOUT_MS,
    sendLimitPerMinute = DEFAULT_SEND_LIMIT_PER_MINUTE,
    logger = null,
  }) {
    if (!validTelegramToken(token)) throw new TypeError('Telegram Bot Token is invalid');
    if (typeof fetchImpl !== 'function') throw new TypeError('TelegramApi requires fetch');
    if (typeof FormDataImpl !== 'function') throw new TypeError('TelegramApi requires FormData');
    this.#token = token.trim();
    this.#fetch = fetchImpl;
    this.#FormDataImpl = FormDataImpl;
    this.#baseUrl = new URL(baseUrl);
    this.#fileUploadTimeoutMs = positiveTimeout(fileUploadTimeoutMs, 'fileUploadTimeoutMs');
    this.#sendLimit = Number.isInteger(sendLimitPerMinute) && sendLimitPerMinute >= 1
      ? sendLimitPerMinute
      : DEFAULT_SEND_LIMIT_PER_MINUTE;
    this.#logger = logger;
  }

  async getMe(options = {}) {
    return this.#call('getMe', {}, options);
  }

  async getWebhookInfo(options = {}) {
    return this.#call('getWebhookInfo', {}, options);
  }

  /**
   * Look a chat up by numeric id, `@username` or an invite link.
   *
   * The settings page uses this to turn a pasted group reference into a chat
   * id; the bot must already be able to see the chat for the lookup to work.
   */
  async getChat({ chatId, signal } = {}) {
    const id = cleanString(chatId);
    if (!id || id.length > 512) throw new TypeError('Telegram chat id is invalid');
    return this.#call('getChat', { chat_id: id }, { signal });
  }

  async getUpdates({ offset, timeout = 25, signal } = {}) {
    const payload = {
      timeout,
      limit: 100,
      allowed_updates: ['message', 'callback_query'],
      ...(Number.isSafeInteger(offset) ? { offset } : {}),
    };
    return this.#call('getUpdates', payload, {
      signal,
      timeoutMs: Math.max(10_000, (timeout + 10) * 1_000),
    });
  }

  async getFile({ fileId, signal } = {}) {
    const id = cleanString(fileId);
    if (!id || !/^[A-Za-z0-9_-]{1,512}$/.test(id)) {
      throw new TypeError('Telegram file id is invalid');
    }
    return this.#call('getFile', { file_id: id }, { signal });
  }

  async downloadFile({ fileId, signal, maxBytes } = {}) {
    const url = await this.#downloadUrl(fileId, signal);
    return fetchImageBuffer(url, {
      fetchImpl: this.#fetch,
      signal,
      maxBytes,
      allowedHosts: TELEGRAM_FILE_HOSTS,
    });
  }

  async downloadFileStream({ fileId, signal } = {}) {
    const url = await this.#downloadUrl(fileId, signal);
    return fetchFileStream(url, {
      fetchImpl: this.#fetch,
      signal,
      allowedHosts: TELEGRAM_FILE_HOSTS,
    });
  }

  async #downloadUrl(fileId, signal) {
    const file = await this.getFile({ fileId, signal });
    const filePath = cleanString(file?.file_path);
    if (!filePath || filePath.startsWith('/') || filePath.includes('\\')
      || filePath.includes('?') || filePath.includes('#')) {
      throw new Error('Telegram returned an invalid file path');
    }
    let decodedSegments;
    try {
      decodedSegments = filePath.split('/').map((segment) => decodeURIComponent(segment));
    } catch {
      throw new Error('Telegram returned an invalid file path');
    }
    if (decodedSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('Telegram returned an invalid file path');
    }
    const url = new URL(this.#baseUrl);
    url.pathname = `/file/bot${this.#token}/${filePath}`;
    return url;
  }

  async sendMessage({ chatId, text, replyToMessageId, messageThreadId, replyMarkup, signal }) {
    return this.#sendMessageCall('sendMessage', {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...(replyToMessageId ? {
        reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true },
      } : {}),
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      ...(replyMarkup === undefined ? {} : { reply_markup: inputReplyMarkup(replyMarkup) }),
    }, { signal });
  }

  /** Acknowledge a button press so the client stops showing its progress spinner. */
  async answerCallbackQuery({ callbackQueryId, text, signal }) {
    const queryId = cleanString(callbackQueryId);
    if (!queryId) throw new TypeError('Telegram callback query id is required');
    const notice = cleanString(text);
    return this.#call('answerCallbackQuery', {
      callback_query_id: queryId,
      ...(notice ? { text: notice } : {}),
    }, { signal });
  }

  /** Replace only the keyboard of an existing message, keeping its text intact. */
  async editMessageReplyMarkup({ chatId, messageId, replyMarkup, signal }) {
    if (!Number.isSafeInteger(messageId)) {
      throw new TypeError('Telegram message id must be a safe integer');
    }
    return this.#callUnbudgeted('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      ...(replyMarkup === undefined ? {} : { reply_markup: inputReplyMarkup(replyMarkup) }),
    }, { signal });
  }

  async setMessageReaction({ chatId, messageId, emoji, signal, timeoutMs }) {
    const normalizedEmoji = cleanString(emoji);
    return this.#call('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: normalizedEmoji ? [{ type: 'emoji', emoji: normalizedEmoji }] : [],
    }, { signal, timeoutMs });
  }

  async sendRichMessage({
    chatId,
    richMessage,
    replyToMessageId,
    messageThreadId,
    signal,
  }) {
    return this.#sendMessageCall('sendRichMessage', {
      chat_id: chatId,
      rich_message: inputRichMessage(richMessage),
      ...(replyToMessageId ? {
        reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true },
      } : {}),
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    }, { signal });
  }

  async sendRichMessageDraft({ chatId, draftId, richMessage, messageThreadId, signal }) {
    if (!Number.isSafeInteger(draftId) || draftId === 0) {
      throw new TypeError('Telegram rich message draft id must be a non-zero integer');
    }
    return this.#callUnbudgeted('sendRichMessageDraft', {
      chat_id: chatId,
      draft_id: draftId,
      rich_message: inputRichMessage(richMessage),
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    }, { signal });
  }

  async sendDocument({ chatId, file, replyToMessageId, messageThreadId, signal }) {
    return this.#sendArtifact('sendDocument', 'document', 'document', {
      chatId,
      file,
      replyToMessageId,
      messageThreadId,
      signal,
    });
  }

  async sendPhoto({ chatId, file, replyToMessageId, messageThreadId, signal }) {
    return this.#sendArtifact('sendPhoto', 'photo', 'photo', {
      chatId,
      file,
      replyToMessageId,
      messageThreadId,
      signal,
    });
  }

  async #sendArtifact(method, fieldName, mediaLabel, {
    chatId,
    file,
    replyToMessageId,
    messageThreadId,
    signal,
  }) {
    if (!file || typeof file !== 'object'
      || typeof file.fileName !== 'string' || !file.fileName
      || !Buffer.isBuffer(file.bytes)) {
      throw new TypeError(`A Telegram ${mediaLabel} is required`);
    }
    if (signal?.aborted) throw abortReason(signal);
    // A multipart body can be consumed only once, so every attempt rebuilds it.
    const dispatch = async () => {
      // The upload timeout starts here, not when the caller asked for the send:
      // a file queued behind the chat's send budget (or behind a 429 retry)
      // would otherwise expire before its first request even opens, and the
      // file would be reported as uncertain although nothing was sent.
      const uploadSignal = requestSignal(signal, this.#fileUploadTimeoutMs);
      const payload = new this.#FormDataImpl();
      payload.append('chat_id', String(chatId));
      payload.append(
        fieldName,
        new Blob([file.bytes], { type: file.mediaType ?? 'application/octet-stream' }),
        file.fileName,
      );
      if (replyToMessageId) {
        payload.append('reply_parameters', JSON.stringify({
          message_id: replyToMessageId,
          allow_sending_without_reply: true,
        }));
      }
      if (messageThreadId) payload.append('message_thread_id', String(messageThreadId));
      try {
        return await this.#call(method, payload, {
          signal: uploadSignal,
          timeoutMs: this.#fileUploadTimeoutMs,
          multipart: true,
        });
      } catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        if (error?.deliveryOutcome === 'unknown') {
          throw uncertainTelegramDelivery(error?.cause ?? error, mediaLabel);
        }
        if (error?.code?.startsWith?.('telegram-')) {
          throw telegramArtifactProviderError(error, mediaLabel);
        }
        throw uncertainTelegramDelivery(error, mediaLabel);
      }
    };
    return this.#sendMessageCall(method, { chat_id: chatId }, { signal }, dispatch);
  }

  /**
   * Run a message-creating call inside the chat's send budget and retry it
   * while Telegram answers 429.
   *
   * Only these calls are budgeted: Telegram charges its per-chat limit for new
   * messages, while edits, drafts, typing actions, reactions and callback
   * acknowledgements are free and must stay responsive during a burst.
   */
  async #sendMessageCall(method, payload, options, dispatch = null) {
    const { signal } = options;
    const chatId = String(payload.chat_id ?? '');
    await this.#reserveSendSlot(method, chatId, signal);
    let waitedMs = 0;
    const attempts = [];
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await (dispatch ?? (() => this.#call(method, payload, options)))();
      } catch (error) {
        attempts.push(sendAttemptRecord(method, attempt, error));
        const retryAfter = rateLimitRetryAfter(error);
        if (retryAfter === null) throw withSendAttempts(error, attempts);
        const delayMs = Math.ceil(retryAfter * 1000);
        if (attempt >= MAX_SEND_ATTEMPTS || waitedMs + delayMs > MAX_RATE_LIMIT_WAIT_MS) {
          const limited = preserveProviderMetadata(new Error(
            `Telegram ${method} is rate limited in chat ${chatId}`,
            { cause: error },
          ), error);
          limited.code = 'channel-rate-limit';
          // The caller still has to tell the user when the chat frees up.
          limited.retry_after = retryAfter;
          limited.retryAfter = retryAfter;
          throw withSendAttempts(limited, attempts);
        }
        waitedMs += delayMs;
        this.#log(
          `[dsh-im:telegram] chat ${chatId} ${method} rate limited by Telegram,`
          + ` retrying in ${delayMs} ms (attempt ${attempt + 1} of ${MAX_SEND_ATTEMPTS})`,
        );
        await waitForDelay(delayMs, signal);
      }
    }
  }

  /**
   * Wait until this chat has a free slot in its budget.
   *
   * The budget belongs to the chat, not to the bot, so one busy group cannot
   * starve the others. Waiting beats dropping: the caller's message is what the
   * user asked for, and a slot always comes free within the window.
   */
  async #reserveSendSlot(method, chatId, signal) {
    // Parallel callers to the same chat must queue up, otherwise they would all
    // read the same free budget and overshoot the limit together.
    const previous = this.#sendQueue.get(chatId) ?? Promise.resolve();
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.#sendQueue.set(chatId, tail);
    await previous;
    try {
      await this.#waitForSendBudget(method, chatId, signal);
    } finally {
      release();
      if (this.#sendQueue.get(chatId) === tail) this.#sendQueue.delete(chatId);
    }
  }

  async #waitForSendBudget(method, chatId, signal) {
    for (;;) {
      if (signal?.aborted) throw abortReason(signal);
      const now = Date.now();
      const recent = (this.#sendTimestamps.get(chatId) ?? [])
        .filter((at) => now - at < SEND_WINDOW_MS);
      if (recent.length < this.#sendLimit) {
        recent.push(now);
        this.#sendTimestamps.set(chatId, recent);
        return;
      }
      const delayMs = SEND_WINDOW_MS - (now - recent[0]);
      this.#sendTimestamps.set(chatId, recent);
      this.#log(
        `[dsh-im:telegram] chat ${chatId} ${method} waits ${delayMs} ms`
        + ` for the next send slot (limit ${this.#sendLimit} per minute)`,
      );
      await waitForDelay(delayMs, signal);
    }
  }

  /**
   * Call a method that Telegram does not charge against the send budget.
   *
   * A 429 here is not retried: the frame it carries is already superseded by the
   * next one, and waiting would stall the stream. It resolves to `undefined`
   * instead of rejecting, because a rejected edit has nobody waiting for it and
   * would surface as an unhandled rejection; a caller that needs the edit to be
   * on screen checks for `undefined` and falls back.
   */
  async #callUnbudgeted(method, payload, options = {}) {
    try {
      return await this.#call(method, payload, options);
    } catch (error) {
      if (rateLimitRetryAfter(error) === null) throw error;
      this.#log(
        `[dsh-im:telegram] chat ${String(payload.chat_id ?? '')} ${method}`
        + ' rate limited; skipping this update',
      );
      return undefined;
    }
  }

  #log(message) {
    this.#logger?.warn?.(message);
  }

  async editMessageText({ chatId, messageId, text, richMessage, replyMarkup, signal }) {
    if ((text === undefined) === (richMessage === undefined)) {
      throw new TypeError('Telegram message edit requires exactly one of text or richMessage');
    }
    // Product invariant (route map F7): a rich answer never carries an inline
    // keyboard — cards always use regular text. The Bot API would technically
    // accept reply_markup next to rich_message, so this guard is deliberate.
    if (richMessage !== undefined && replyMarkup !== undefined) {
      throw new TypeError(
        'A rich Telegram answer never carries an inline keyboard; use regular text for cards',
      );
    }
    return this.#callUnbudgeted('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      ...(text === undefined ? { rich_message: inputRichMessage(richMessage) } : {
        text,
        link_preview_options: { is_disabled: true },
      }),
      ...(replyMarkup === undefined ? {} : { reply_markup: inputReplyMarkup(replyMarkup) }),
    }, { signal });
  }

  /** Telegram notifies on new messages only, never on edits, so dropping the
   *  progress placeholder takes a delete rather than a rewrite. */
  async deleteMessage({ chatId, messageId, signal }) {
    return this.#call('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    }, { signal });
  }

  async sendChatAction({ chatId, messageThreadId, signal }) {
    return this.#call('sendChatAction', {
      chat_id: chatId,
      action: 'typing',
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    }, { signal });
  }

  async setMyCommands({ commands, scope, languageCode, signal } = {}) {
    validateTelegramCommands(commands);
    return this.#call('setMyCommands', {
      commands,
      ...(scope ? { scope } : {}),
      ...(cleanString(languageCode) ? { language_code: cleanString(languageCode) } : {}),
    }, { signal });
  }

  async deleteMyCommands({ scope, languageCode, signal } = {}) {
    return this.#call('deleteMyCommands', {
      ...(scope ? { scope } : {}),
      ...(cleanString(languageCode) ? { language_code: cleanString(languageCode) } : {}),
    }, { signal });
  }

  async setChatMenuButton({ menuButton = COMMANDS_MENU_BUTTON, signal } = {}) {
    if (!menuButton || typeof menuButton !== 'object' || Array.isArray(menuButton)) {
      throw new TypeError('Telegram menu button is invalid');
    }
    return this.#call('setChatMenuButton', { menu_button: menuButton }, { signal });
  }

  async #call(method, payload, { signal, timeoutMs = 15_000, multipart = false } = {}) {
    if (signal?.aborted) throw abortReason(signal);
    const url = new URL(this.#baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/bot${this.#token}/${method}`;
    let response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        ...(multipart ? {} : { headers: { 'content-type': 'application/json' } }),
        body: multipart ? payload : JSON.stringify(payload),
        signal: requestSignal(signal, timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      const transport = new Error(`Telegram ${method} transport failed`, { cause: error });
      transport.code = error?.name === 'TimeoutError'
        ? 'telegram-timeout'
        : error?.name === 'AbortError'
          ? 'telegram-aborted-after-dispatch'
          : 'telegram-transport-error';
      transport.deliveryOutcome = 'unknown';
      throw transport;
    }
    let body;
    try {
      body = await response.json();
    } catch (cause) {
      const error = new Error(`Telegram ${method} returned invalid JSON`, { cause });
      error.status = response?.status;
      error.code = 'telegram-response-invalid';
      error.deliveryOutcome = 'unknown';
      throw error;
    }
    if (!response.ok || body?.ok !== true) {
      const description = cleanString(body?.description);
      const error = new Error(description ?? `Telegram ${method} failed`);
      error.code = Number.isInteger(body?.error_code) ? `telegram-${body.error_code}` : 'telegram-api-error';
      error.status = response.status;
      if (Number.isInteger(body?.error_code)) error.providerCode = body.error_code;
      const retryAfter = Number(body?.parameters?.retry_after);
      if (Number.isFinite(retryAfter) && retryAfter >= 0) {
        error.retry_after = retryAfter;
        error.retryAfter = retryAfter;
      }
      throw error;
    }
    return body.result;
  }
}

export async function inspectTelegramToken(token, options = {}) {
  const api = new TelegramApi({ token, ...options });
  const bot = await api.getMe();
  if (!bot?.id || bot?.is_bot !== true) throw new Error('Telegram token does not belong to a bot');
  return {
    platformId: String(bot.id),
    name: cleanString([bot.first_name, bot.last_name].filter(Boolean).join(' ')) ?? t('Telegram机器人'),
    username: cleanString(bot.username),
  };
}
