import { t } from './i18n.mjs';

export const BATCH_INPUT_LIMIT = 10;

const BATCH_COMMAND = /^\/(batch|send|cancel)(?=$|\s)/iu;
const EXACT_BATCH_COMMAND = /^\/(batch|send|cancel)$/iu;

function commandName(text) {
  if (typeof text !== 'string') return null;
  return BATCH_COMMAND.exec(text.trim())?.[1]?.toLowerCase() ?? null;
}

function result(kind, message, extra = {}) {
  return { handled: true, kind, ...(message ? { message } : {}), ...extra };
}

function progressMessage(count) {
  if (count === BATCH_INPUT_LIMIT) {
    return t(`当前已处于批量输入模式，已收集 {count}/{limit} 条。
请发送 /send 提交或 /cancel 取消。`, { count, limit: BATCH_INPUT_LIMIT });
  }
  return t(`当前已处于批量输入模式，已收集 {count}/{limit} 条。
完成后发送 /send，取消请发送 /cancel。`, { count, limit: BATCH_INPUT_LIMIT });
}

function submissionPrompt(messages) {
  const sections = messages.map((message, index) => (
    `${t('[消息 {index}]', { index: index + 1 })}\n${message}`
  ));
  return [
    t('以下是用户通过批量输入模式发送的多条内容，请按顺序作为同一次输入统一处理。'),
    ...sections,
  ].join('\n\n');
}

/**
 * Session title for one submission.
 *
 * The submitted prompt is dsh-im's own composition -- a framing sentence plus
 * `[消息 N]` labels -- so using it as the conversation title would put plugin
 * text where the user's own words belong. The first collected message is what
 * the user actually said first.
 */
function submissionTitle(messages) {
  return messages.find((message) => message.trim()) ?? '';
}

export function isBatchInputCommand(text) {
  return commandName(text) !== null;
}

export function batchInputGroupUnsupportedMessage() {
  return t('批量输入模式仅支持私聊，请在与机器人的私聊中使用。');
}

export function batchInputBusyMessage() {
  return t(`当前聊天有正在运行的任务、待回答问题或待审批请求。
请先完成当前交互或发送 /stop，再使用 /batch。`);
}

export class BatchInputManager {
  #batches = new Map();

  status(key) {
    const batch = this.#batches.get(key);
    if (!batch) {
      return Object.freeze({ phase: 'idle', count: 0, limit: BATCH_INPUT_LIMIT, full: false });
    }
    return Object.freeze({
      phase: batch.phase,
      count: batch.messages.length,
      limit: BATCH_INPUT_LIMIT,
      full: batch.messages.length === BATCH_INPUT_LIMIT,
    });
  }

  handle(key, text, { plainText = true } = {}) {
    const batch = this.#batches.get(key);
    const name = commandName(text);
    const exact = typeof text === 'string' ? EXACT_BATCH_COMMAND.exec(text.trim()) : null;

    if (name && !exact) {
      return result('invalid-command', t('用法：/{command}（不带参数）', { command: name }));
    }

    if (!batch) {
      if (!name) return { handled: false };
      // Only starting a batch requires the plain-text command itself; /send and
      // /cancel carry no content, so they must answer with their own state
      // message instead of being refused as uncollectable content.
      if (!plainText && name === 'batch') {
        return result('unsupported-content', t('批量输入命令仅支持纯文字，请移除图片、文件或引用消息后重试。'));
      }
      if (name === 'send') {
        return result('no-batch', t('当前没有待提交的批量内容，请先发送 /batch。'));
      }
      if (name === 'cancel') {
        return result('no-batch', t('当前没有正在进行的批量输入。'));
      }
      this.#batches.set(key, { phase: 'collecting', messages: [], token: null });
      return result('started', t(`已进入批量输入模式，最多可发送 {limit} 条文字。
完成后发送 /send，取消请发送 /cancel。`, { limit: BATCH_INPUT_LIMIT }), {
        count: 0,
        limit: BATCH_INPUT_LIMIT,
      });
    }

    // A command is never collected content: /send, /cancel and a repeated
    // /batch must keep working even when the message that carries them is a
    // quoted reply, an image caption or a file. Only the collected text itself
    // has to be plain.
    if (!plainText && batch.phase === 'collecting' && !name) {
      return result('unsupported-content', t(`批量输入模式目前仅支持文字，不支持图片、文件或引用消息，这条消息未收录。
请继续发送文字，或使用 /send、/cancel。`), {
        count: batch.messages.length,
        limit: BATCH_INPUT_LIMIT,
      });
    }

    if (batch.phase === 'submitting') {
      if (name === 'send') {
        return result('submitting', t('当前批次正在提交，请勿重复发送 /send。'));
      }
      if (name === 'cancel') {
        return result('submitting', t(`批量内容已经提交，无法取消。
如需停止当前任务，请发送 /stop。`));
      }
      if (name === 'batch') {
        return result('submitting', t('当前批次正在提交，请等待处理完成后再开启新批次。'));
      }
      return { handled: false };
    }

    if (name === 'batch') {
      return result('status', progressMessage(batch.messages.length), {
        count: batch.messages.length,
        limit: BATCH_INPUT_LIMIT,
      });
    }

    if (name === 'cancel') {
      const count = batch.messages.length;
      this.#batches.delete(key);
      return result('cancelled', count === 0
        ? t('已取消批量输入。')
        : t('已取消批量输入，共丢弃 {count} 条消息。', { count }), { count });
    }

    if (name === 'send') {
      if (batch.messages.length === 0) {
        return result('empty', t('当前批次还没有内容，请先发送文字，或使用 /cancel 取消。'), {
          count: 0,
        });
      }
      const messages = Object.freeze([...batch.messages]);
      const token = Object.freeze({});
      batch.phase = 'submitting';
      batch.token = token;
      return result('submit', null, {
        token,
        messages,
        prompt: submissionPrompt(messages),
        title: submissionTitle(messages),
        count: messages.length,
      });
    }

    if (typeof text !== 'string') {
      return result('unsupported-content', t(`批量输入模式目前仅支持文字，不支持图片、文件或引用消息，这条消息未收录。
请继续发送文字，或使用 /send、/cancel。`), {
        count: batch.messages.length,
        limit: BATCH_INPUT_LIMIT,
      });
    }

    if (text.trim().startsWith('/')) {
      return result('blocked-command', t('当前正在批量输入，请先发送 /send 提交或 /cancel 取消。'), {
        count: batch.messages.length,
        limit: BATCH_INPUT_LIMIT,
      });
    }

    if (batch.messages.length === BATCH_INPUT_LIMIT) {
      return result('full', t(`当前批次已满，这条消息未收录。
请先发送 /send 提交或 /cancel 取消，然后重新发送这条消息。`), {
        count: BATCH_INPUT_LIMIT,
        limit: BATCH_INPUT_LIMIT,
      });
    }

    batch.messages.push(text);
    const count = batch.messages.length;
    return result('collected', count === BATCH_INPUT_LIMIT
      ? t('已收集 {count}/{limit} 条，当前批次已满，请发送 /send 提交或 /cancel 取消。', {
        count,
        limit: BATCH_INPUT_LIMIT,
      })
      : null, {
      count,
      limit: BATCH_INPUT_LIMIT,
    });
  }

  complete(key, token) {
    const batch = this.#batches.get(key);
    if (!batch || batch.phase !== 'submitting' || batch.token !== token) {
      return Object.freeze({ completed: false });
    }
    const count = batch.messages.length;
    this.#batches.delete(key);
    return Object.freeze({ completed: true, count });
  }

  fail(key, token) {
    const batch = this.#batches.get(key);
    if (!batch || batch.phase !== 'submitting' || batch.token !== token) {
      return Object.freeze({ retained: false });
    }
    batch.phase = 'collecting';
    batch.token = null;
    const count = batch.messages.length;
    return Object.freeze({
      retained: true,
      count,
      message: t(`批量内容提交失败，已保留 {count} 条消息。
请再次发送 /send 重试或 /cancel 取消。`, { count }),
    });
  }
}
