import { createHash } from 'node:crypto';

import { trackOutboundArtifactProviderPromise } from '../shared/semantic/artifact.mjs';
import { createDeliveryReceipt } from '../shared/semantic/delivery.mjs';
import { t } from '../shared/i18n.mjs';

const STREAM_ELEMENT_ID = 'stream_md';
const DEFAULT_INITIAL_TEXT = '已连接 DeepSeek Harness，正在思考…';
const MAX_STREAM_CHARS = 28000;
const MAX_FILE_OPERATION_TIMEOUT_MS = 120_000;
const COT_API = '/open-apis/im/v1/message_cot';

const FILE_DELIVERY_ERRORS = new Map([
  [99991672, ['artifact-permission-required', 'Feishu file delivery requires the im:resource permission.']],
  [234006, ['artifact-too-large', 'The result file exceeds Feishu\'s size limit.']],
  [234010, ['artifact-empty', 'Feishu does not accept empty files.']],
  [230017, ['artifact-provider-rejected', 'Feishu rejected the uploaded file ownership.']],
  [230020, ['artifact-rate-limited', 'Feishu temporarily rate-limited file delivery.']],
  [230049, ['artifact-delivery-uncertain', 'Feishu could not confirm the file message result.']],
  [230055, ['artifact-provider-rejected', 'Feishu rejected the file message type.']],
]);

function assertApiSuccess(operation, response) {
  if (response?.code && response.code !== 0) {
    throw new Error(`${operation} failed: ${response.msg || response.code}`);
  }
  return response;
}

function providerErrorCode(cause) {
  const pending = [cause];
  const seen = new Set();
  let fallback;
  while (pending.length > 0) {
    const value = pending.shift();
    if (!value || seen.has(value)) continue;
    if (typeof value === 'object') seen.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const code = Number(value?.code);
    if (Number.isFinite(code) && code !== 0) {
      if (FILE_DELIVERY_ERRORS.has(code)) return code;
      fallback ??= code;
    }
    pending.push(value?.response?.data, value?.data, value?.error, value?.cause);
  }
  return fallback;
}

function fileDeliveryError(stage, cause, providerCode, { uncertain = false } = {}) {
  const explicitCode = providerCode === undefined || providerCode === null
    ? undefined
    : Number(providerCode);
  const code = Number.isFinite(explicitCode) && explicitCode !== 0
    ? explicitCode
    : providerErrorCode(cause);
  const fallback = Number.isFinite(code)
    ? ['artifact-provider-rejected', `Feishu rejected file ${stage}.`]
    : uncertain
      ? ['artifact-delivery-uncertain', 'Feishu could not confirm the file message result.']
      : ['artifact-provider-failed', `Feishu file ${stage} failed.`];
  const [errorCode, message] = FILE_DELIVERY_ERRORS.get(code) ?? fallback;
  const error = new Error(message, { cause });
  error.code = errorCode;
  if (Number.isFinite(code)) error.providerCode = code;
  return error;
}

function boundedFileTimeout(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_FILE_OPERATION_TIMEOUT_MS) {
    throw new TypeError(`${name} must be an integer between 1 and ${MAX_FILE_OPERATION_TIMEOUT_MS}`);
  }
  return value;
}

function abortReason(signal) {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function operationTimeout(stage) {
  const error = new Error(`Feishu ${stage} timed out.`);
  error.code = 'provider-timeout';
  return error;
}

// Bound the caller's wait even when the SDK does not honor cancellation.
export function waitForFeishuOperation(operation, { signal, timeoutMs, stage = 'request' }) {
  signal?.throwIfAborted();
  const deadline = new AbortController();
  const operationSignal = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operationSignal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(
      reject,
      signal?.aborted ? abortReason(signal) : operationTimeout(stage),
    );
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    operationSignal.addEventListener('abort', onAbort, { once: true });

    Promise.resolve().then(() => {
      operationSignal.throwIfAborted();
      return operation(operationSignal);
    }).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (operationSignal.aborted) onAbort();
  });
}

function waitForFileOperation(operation, { stage, ...options }) {
  return waitForFeishuOperation(operation, { ...options, stage: `file ${stage}` });
}

function deliveryUuid(file, chatId, messageType) {
  const seed = `${file.deliveryKey}\u0000${chatId}`;
  const digest = createHash('sha256')
    .update(messageType === 'file' ? seed : `${seed}\u0000${messageType}`)
    .digest('hex')
    .slice(0, 40);
  return `dshim_${digest}`;
}

function summaryOf(text) {
  const summary = String(text ?? '').replace(/\s+/g, ' ').trim();
  return summary.length <= 50 ? summary : `${streamTextPrefix(summary, 49)}…`;
}

function streamTextPrefix(text, maxChars) {
  let end = Math.min(text.length, maxChars);
  // Keep a UTF-16 surrogate pair together when the limit lands inside an emoji.
  const before = text.charCodeAt(end - 1);
  const after = text.charCodeAt(end);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1;
  return text.slice(0, end);
}

function streamPreview(text) {
  if (text.length <= MAX_STREAM_CHARS) return text;
  const notice = `\n\n${t('内容较长，生成完成后将分段发送完整回答。')}`;
  return streamTextPrefix(text, MAX_STREAM_CHARS - notice.length) + notice;
}

function splitStreamContent(text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > MAX_STREAM_CHARS) {
    const prefix = streamTextPrefix(remaining, MAX_STREAM_CHARS);
    let end = prefix.lastIndexOf('\n') + 1;
    if (end < MAX_STREAM_CHARS * 0.6) end = prefix.length;
    chunks.push(remaining.slice(0, end));
    // Unlike plain-text fallback splitting, keep all whitespace in the answer.
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function streamingCard(initialText) {
  return {
    schema: '2.0',
    config: {
      streaming_mode: true,
      summary: { content: t('正在生成…') },
      streaming_config: {
        print_frequency_ms: { default: 70 },
        print_step: { default: 1 },
        print_strategy: 'fast',
      },
    },
    body: {
      elements: [{
        tag: 'markdown',
        element_id: STREAM_ELEMENT_ID,
        content: initialText,
      }],
    },
  };
}

export class VerifiedFeishuChannel {
  #client;
  #initialText;
  #fileUploadTimeoutMs;
  #fileMessageTimeoutMs;

  constructor({
    client,
    initialText,
    fileUploadTimeoutMs = MAX_FILE_OPERATION_TIMEOUT_MS,
    fileMessageTimeoutMs = MAX_FILE_OPERATION_TIMEOUT_MS,
  }) {
    this.#client = client;
    this.#initialText = String(initialText ?? t(DEFAULT_INITIAL_TEXT)) || '…';
    this.#fileUploadTimeoutMs = boundedFileTimeout(fileUploadTimeoutMs, 'fileUploadTimeoutMs');
    this.#fileMessageTimeoutMs = boundedFileTimeout(fileMessageTimeoutMs, 'fileMessageTimeoutMs');
  }

  async stream(chatId, input, options = {}) {
    if (typeof input?.markdown !== 'function') {
      throw new Error('Feishu stream requires a markdown producer');
    }

    const cards = [];
    let activeCard = null;
    let rotating = false;
    let awaitingPresentation = false;
    // issue #163：过程写卡与换卡定格共用一条写队列串行化——在途写必然先于
    // 定格完成，消除「写飞越定格」竞态；前序失败不阻塞后续写入。
    let writeQueue = Promise.resolve();
    const enqueue = (job) => {
      const run = writeQueue.then(job, job);
      writeQueue = run.catch(() => undefined);
      return run;
    };
    try {
      activeCard = await this.#createStreamCard(chatId, options);
      cards.push(activeCard);
      let lastContent = this.#initialText;
      let lastContentIsTransient = true;
      // Track the current card separately from incoming snapshots: held or
      // failed writes have not delivered any text that can be deduplicated.
      let activeView = lastContent;
      let activeTextPrefix = null;
      // issue #86：独立交互消息（提问/审批）落在占位卡下方后，最终答案不得
      // 回写旧卡。rotate() 把旧卡定格为「过程记录 + 指引行」并标记换卡态；
      // 下一次 setContent（过程更新或最终答案）才创建新卡——新卡必然创建于
      // 交互消息之后。旧卡纳入 cards，参与 recall 与 providerMessageIds。
      // issue #163：定格后进入换卡挂起（awaitingPresentation），挂起期内
      // setContent 只推进快照、不建卡不写卡；bridge 呈现交互消息后调用
      // interactionPresented() 解除挂起，此后建的新卡必然位于交互消息下方。
      const ensureActiveCard = async () => {
        if (!rotating) return activeCard;
        activeCard = await this.#createStreamCard(chatId, options);
        activeView = this.#initialText;
        activeTextPrefix = null;
        cards.push(activeCard);
        rotating = false;
        return activeCard;
      };
      // issue #163：冻结前缀去重——换卡定格时旧卡已展示 frozenContent；此后
      // 新卡只展示剥离该前缀后的增量（重放快照剥为空白则跳过写卡），终稿
      // 分段同样使用增量视图，提问前的过程不再重复播放。
      let frozenContent = null;
      const applyFrozenDedup = (next) => {
        if (frozenContent === null || !next.startsWith(frozenContent)) return next;
        const rest = next.slice(frozenContent.length);
        return rest.trim().length > 0 ? rest : ''; // 不改写增量原文；全空白视为无增量
      };
      // 评审补充（#163）：去重基线与定格内容必须以「旧卡实际展示的内容」为准——
      // 超长快照的旧卡只展示了截断前缀，若冻结完整 lastContent，未展示的尾部
      // 会被整段剥掉而丢失；再次换卡时旧卡展示的是上一轮增量，不得回写完整快照。
      const shownPrefixOf = (text) => {
        const notice = `\n\n${t('内容较长，生成完成后将分段发送完整回答。')}`;
        return text.length <= MAX_STREAM_CHARS
          ? text
          : streamTextPrefix(text, MAX_STREAM_CHARS - notice.length);
      };
      const controller = {
        get messageId() {
          return activeCard.messageId;
        },
        interactionPresented: () => {
          awaitingPresentation = false;
        },
        rotate: () => enqueue(async () => {
          if (rotating) return;
          rotating = true;
          awaitingPresentation = true;
          const shownPrefix = shownPrefixOf(activeView);
          try {
            await this.#updateStreamCard(
              activeCard,
              `${streamPreview(shownPrefix)}\n\n${t('⤵️ 最终结果见下方')}`,
            );
            // Tool/status messages remain visible but never extend the text
            // prefix. Only a successfully displayed text snapshot advances it.
            if (activeTextPrefix !== null) frozenContent = activeTextPrefix;
            await this.#finishStreamCard(activeCard);
          } catch (error) {
            // 明确降级：定格失败不阻塞交互呈现，旧卡保留原内容。
            console.warn('[dsh-feishu] unable to finalize the superseded stream card:', error.message);
          }
        }),
        setContent: (content, { transient = false } = {}) => enqueue(async () => {
          const next = String(content ?? '') || '…';
          // Retain the latest snapshot even if it is a replay or a held write.
          lastContent = next;
          lastContentIsTransient = transient;
          const visible = transient ? next : applyFrozenDedup(next);
          if (visible === '') return; // 重放快照不建卡不写卡
          if (awaitingPresentation) return; // 换卡挂起：视图已推进，仅挂起卡片写入
          const card = await ensureActiveCard();
          await this.#updateStreamCard(card, streamPreview(visible));
          activeView = visible;
          const previousPrefix = frozenContent !== null && next.startsWith(frozenContent)
            ? frozenContent
            : '';
          activeTextPrefix = transient ? null : previousPrefix + shownPrefixOf(visible);
        }),
      };

      await input.markdown(controller);
      await enqueue(async () => {
        // 终稿强制解除挂起：异常路径下呈现通知缺失时仍可收尾。
        awaitingPresentation = false;
        // Recompute from the final snapshot, including an empty delta, rather
        // than retaining the last nonempty progress/tool view as the answer.
        const finalView = (lastContentIsTransient ? lastContent : applyFrozenDedup(lastContent))
          || lastContent;
        const chunks = splitStreamContent(finalView);
        for (const [index, chunk] of chunks.entries()) {
          const card = index === 0
            ? await ensureActiveCard()
            : await this.#createStreamCard(chatId, options);
          if (index > 0) cards.push(card);
          await this.#updateStreamCard(card, chunk);
          await this.#finishStreamCard(card);
        }
      });
      return {
        messageId: cards[0].messageId,
        providerMessageIds: cards.map((card) => card.messageId),
      };
    } catch (error) {
      // Preserve the existing provider-error fallback contract: the bridge
      // resends the completed answer, so remove any cards it would duplicate.
      for (const card of cards) await this.#recall(card.messageId);
      throw error;
    }
  }

  async sendFile(chatId, file, {
    replyTo,
    signal,
    replyInThread = false,
    onReplyThreadId,
  } = {}) {
    return this.#sendArtifact(chatId, file, {
      replyTo,
      signal,
      replyInThread,
      onReplyThreadId,
      messageType: 'file',
      presentation: 'feishu-file',
    });
  }

  async sendImage(chatId, file, {
    replyTo,
    signal,
    replyInThread = false,
    onReplyThreadId,
  } = {}) {
    return this.#sendArtifact(chatId, file, {
      replyTo,
      signal,
      replyInThread,
      onReplyThreadId,
      messageType: 'image',
      presentation: 'feishu-image',
    });
  }

  /** Open one native Feishu thinking-process message. */
  async createCot(chatId, { replyTo, hidden = false } = {}) {
    const response = assertApiSuccess('Feishu message_cot.create', await this.#client.request({
      method: 'POST',
      url: `${COT_API}?receive_id_type=chat_id`,
      data: {
        receive_id: chatId,
        ...(replyTo ? { origin_message_id: replyTo } : {}),
        cot_hidden: hidden === true,
        enable_badge: false,
        update_feed_rank: false,
      },
    }));
    const cotId = response?.data?.cot_id;
    const messageId = response?.data?.message_id;
    if (!cotId || !messageId) {
      throw new Error('Feishu message_cot.create returned no cot_id/message_id');
    }
    return { cotId, messageId };
  }

  /** Append ordered AG-UI events to one native thinking process. */
  async writeCotEvents(handle, events) {
    assertApiSuccess('Feishu message_cot.write', await this.#client.request({
      method: 'PUT',
      url: COT_API,
      data: {
        events,
        message_id: handle.messageId,
        cot_id: handle.cotId,
      },
    }));
  }

  async #sendArtifact(chatId, file, {
    replyTo,
    signal,
    replyInThread = false,
    onReplyThreadId,
    messageType,
    presentation,
  }) {
    signal?.throwIfAborted();
    if (typeof chatId !== 'string' || !chatId) throw new TypeError('chatId is required');
    if (!file || typeof file !== 'object'
      || typeof file.artifactId !== 'string' || !file.artifactId
      || typeof file.deliveryKey !== 'string' || !file.deliveryKey
      || typeof file.fileName !== 'string' || !file.fileName
      || !Buffer.isBuffer(file.bytes)) {
      throw new TypeError('A materialized result file is required');
    }
    let uploaded;
    try {
      uploaded = await waitForFileOperation((operationSignal) => {
        operationSignal.throwIfAborted();
        const pending = messageType === 'image'
          ? this.#client.im.v1.image.create({
              data: {
                image_type: 'message',
                image: file.bytes,
              },
            })
          : this.#client.im.v1.file.create({
              data: {
                file_type: 'stream',
                file_name: file.fileName,
                file: file.bytes,
              },
            });
        trackOutboundArtifactProviderPromise(file, pending);
        return pending;
      }, {
        signal,
        timeoutMs: this.#fileUploadTimeoutMs,
        stage: 'upload',
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      throw fileDeliveryError('upload', error);
    }
    signal?.throwIfAborted();
    const resourceKey = messageType === 'image'
      ? uploaded?.image_key ?? uploaded?.data?.image_key
      : uploaded?.file_key ?? uploaded?.data?.file_key;
    if (typeof resourceKey !== 'string' || !resourceKey) {
      throw fileDeliveryError('upload', undefined, uploaded?.code);
    }

    const uuid = deliveryUuid(file, chatId, messageType);
    const content = JSON.stringify(messageType === 'image'
      ? { image_key: resourceKey }
      : { file_key: resourceKey });
    const request = replyTo
      ? {
          path: { message_id: replyTo },
          data: {
            msg_type: messageType,
            content,
            uuid,
            ...(replyInThread === true ? { reply_in_thread: true } : {}),
          },
        }
      : {
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: messageType, content, uuid },
        };
    const send = () => {
      const pending = replyTo
        ? this.#client.im.v1.message.reply(request)
        : this.#client.im.v1.message.create(request);
      trackOutboundArtifactProviderPromise(file, pending);
      return pending;
    };

    let response;
    try {
      response = await waitForFileOperation(async (operationSignal) => {
        operationSignal.throwIfAborted();
        let result;
        try {
          result = await send();
        } catch (error) {
          if (providerErrorCode(error) !== 230049) throw error;
          result = { code: 230049 };
        }
        operationSignal.throwIfAborted();

        // Feishu documents 230049 as an uncertain asynchronous send result.
        // Reuse the same resource key and UUID once so the provider can deduplicate.
        if (Number(result?.code) === 230049) {
          result = await send();
          operationSignal.throwIfAborted();
        }
        return result;
      }, {
        signal,
        timeoutMs: this.#fileMessageTimeoutMs,
        stage: 'message send',
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      throw fileDeliveryError('message send', error, undefined, { uncertain: true });
    }
    if (Number.isFinite(Number(response?.code)) && Number(response.code) !== 0) {
      throw fileDeliveryError('message send', undefined, response.code, { uncertain: true });
    }
    const messageId = response?.data?.message_id;
    if (typeof messageId !== 'string' || !messageId) {
      throw fileDeliveryError('message send', undefined, undefined, { uncertain: true });
    }
    if (replyTo && replyInThread && typeof onReplyThreadId === 'function') {
      // The reply itself opens the topic, and the response reports its
      // thread_id only sometimes (a direct-chat topic comes back without one).
      // Hand over what we have and let the bridge read it back when missing.
      const threadId = response?.data?.thread_id;
      await onReplyThreadId(typeof threadId === 'string' && threadId ? threadId : null);
    }
    return createDeliveryReceipt({
      deliveryId: file.deliveryKey,
      presentation,
      providerMessageIds: [messageId],
      artifacts: [{
        artifactId: file.artifactId,
        outcome: 'sent',
      }],
    });
  }

  async #createStreamCard(chatId, options = {}) {
    const content = streamPreview(this.#initialText);
    const response = assertApiSuccess('Feishu card.create', await this.#client.cardkit.v1.card.create({
      data: {
        type: 'card_json',
        data: JSON.stringify(streamingCard(content)),
      },
    }));
    const cardId = response?.data?.card_id;
    if (!cardId) throw new Error('Feishu card.create returned no card_id');
    const messageId = await this.#sendCard(chatId, cardId, options);
    return { cardId, messageId, content, sequence: 0 };
  }

  async #updateStreamCard(card, content) {
    if (content === card.content) return;
    const response = await this.#client.cardkit.v1.cardElement.content({
      path: { card_id: card.cardId, element_id: STREAM_ELEMENT_ID },
      data: {
        content,
        sequence: ++card.sequence,
        uuid: `content_${card.cardId}_${card.sequence}`,
      },
    });
    assertApiSuccess('Feishu cardElement.content', response);
    card.content = content;
  }

  async #finishStreamCard(card) {
    const response = await this.#client.cardkit.v1.card.settings({
      path: { card_id: card.cardId },
      data: {
        settings: JSON.stringify({
          config: {
            streaming_mode: false,
            summary: { content: summaryOf(card.content) || t('回答完成') },
          },
        }),
        sequence: ++card.sequence,
        uuid: `settings_${card.cardId}_${card.sequence}`,
      },
    });
    assertApiSuccess('Feishu card.settings', response);
  }

  async #sendCard(chatId, cardId, options = {}) {
    const replyTo = options.replyTo;
    const replyInThread = options.replyInThread === true;
    const content = JSON.stringify({ type: 'card', data: { card_id: cardId } });
    const response = replyTo
      ? await this.#client.im.v1.message.reply({
        path: { message_id: replyTo },
        data: {
          msg_type: 'interactive',
          content,
          ...(replyInThread ? { reply_in_thread: true } : {}),
        },
      })
      : await this.#client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'interactive', content },
      });
    assertApiSuccess('Feishu message send', response);
    const messageId = response?.data?.message_id;
    if (!messageId) throw new Error('Feishu message send returned no message_id');
    if (replyTo && replyInThread && typeof options.onReplyThreadId === 'function') {
      // See #sendArtifact: the topic is created by the reply, but the response
      // may omit its thread_id, so pass it through as it came.
      const threadId = response?.data?.thread_id;
      await options.onReplyThreadId(typeof threadId === 'string' && threadId ? threadId : null);
    }
    return messageId;
  }

  async #recall(messageId, label = 'streaming card') {
    try {
      const response = await this.#client.im.v1.message.delete({
        path: { message_id: messageId },
      });
      assertApiSuccess('Feishu message delete', response);
      return true;
    } catch (error) {
      console.warn('[bridge] unable to recall message:', label, error.message);
      return false;
    }
  }

  async addReaction(messageId, emojiType) {
    const response = assertApiSuccess('Feishu reaction.create', await this.#client.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    }));
    const reactionId = response?.data?.reaction_id;
    if (!reactionId) throw new Error('Feishu reaction.create returned no reaction_id');
    return reactionId;
  }

  /** Delete one previously sent message (step-push heartbeat cleanup). */
  async recallMessage(messageId) {
    return this.#recall(messageId, 'thinking status heartbeat');
  }

  async removeReaction(messageId, reactionId) {
    assertApiSuccess('Feishu reaction.delete', await this.#client.im.v1.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    }));
  }
}
