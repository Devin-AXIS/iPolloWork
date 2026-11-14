// QQ markdown 回复投递：长文尽量按结构边界切分，以 msg_type=2 发送，
// 平台拒绝 markdown 时逐条回退纯文本。

import { t } from '../shared/i18n.mjs';
import { ApiError } from '@tencent-connect/qqbot-nodejs';

import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';
export { chunkMarkdownText } from '../shared/markdown-chunks.mjs';

const MARKDOWN_REJECTION_CODES = new Set([40_034_090]);
const PASSIVE_REPLY_LIMIT = Object.freeze({ c2c: 4, group: 5 });
const PARTIAL_REPLY_NOTICE = () => t('回答较长，后续内容未能通过 QQ 完整发送，请回复“继续”。');

function nextMsgSeq() {
  // 与 SDK getNextMsgSeq 相同的 16-bit 随机 seed；同批分片在 seed 上递增，
  // 保证同一个被动回复 msg_id 内不发生随机碰撞。
  const timePart = Date.now() % 100_000_000;
  const random = Math.floor(Math.random() * 65_536);
  return (timePart ^ random) % 65_536;
}

function isMarkdownRejection(error) {
  return error instanceof ApiError
    && error.httpStatus >= 400
    && error.httpStatus < 500
    && MARKDOWN_REJECTION_CODES.has(Number(error.bizCode));
}

function sendPlainText(bot, target, content, msgSeq) {
  if (typeof bot?.send === 'function') {
    return bot.send({
      target,
      msgType: 0,
      content,
      extra: { msg_seq: msgSeq },
    });
  }
  return bot.sendText(target, content);
}

/**
 * 以 markdown（msg_type=2）发送回复；单条被平台拒绝时回退纯文本（msg_type=0）。
 * 返回每条消息的平台响应，供调用方提取 provider message ids。
 */
export async function sendMarkdownReply(bot, target, text, { logger, signal, requireComplete = false, passiveRepliesUsed = 0 } = {}) {
  const chunks = chunkMarkdownParts(text);
  const results = [];
  const firstMsgSeq = nextMsgSeq();
  // Earlier replies to the same msg_id (for example a timeout notice) spend
  // part of QQ's passive budget; at least one slot is kept for this reply.
  const passiveLimit = target?.msgId
    ? Math.max(1, PASSIVE_REPLY_LIMIT[target.scope] - passiveRepliesUsed) : null;
  const overflow = passiveLimit !== null && chunks.length > passiveLimit;
  const passiveContentCount = overflow ? passiveLimit - 1 : chunks.length;
  const proactiveTarget = target?.msgId
    ? { scope: target.scope, targetId: target.targetId }
    : target;
  let partialNoticeSent = false;

  const sendPartialNotice = async () => {
    if (partialNoticeSent || !target?.msgId) return;
    partialNoticeSent = true;
    try {
      results.push(await sendPlainText(
        bot,
        target,
        PARTIAL_REPLY_NOTICE(),
        (firstMsgSeq + chunks.length) & 0xFFFF,
      ));
    } catch (error) {
      logger?.warn?.('[dsh-im:qq] unable to send partial reply notice:', error);
    }
  };

  for (const [index, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    const msgSeq = (firstMsgSeq + index) & 0xFFFF;
    const deliveryTarget = overflow && index >= passiveContentCount
      ? proactiveTarget
      : target;
    if (typeof bot?.send === 'function') {
      try {
        results.push(await bot.send({
          target: deliveryTarget,
          msgType: 2,
          markdown: { content: chunk.markdown },
          extra: { msg_seq: msgSeq },
        }));
        continue;
      } catch (error) {
        if (!isMarkdownRejection(error)) {
          logger?.warn?.(
            '[dsh-im:qq] markdown delivery outcome is uncertain; refusing a duplicate-prone retry:',
            error,
          );
          if (requireComplete || results.length === 0) throw error;
          await sendPartialNotice();
          break;
        }
        logger?.warn?.('[dsh-im:qq] markdown delivery failed; retrying as plain text:', error);
      }
    }
    // Synthetic Markdown can represent an empty fenced-code body even though
    // its plain equivalent is empty. Never turn that into an invalid QQ text
    // message after a definite Markdown rejection (or on legacy text clients).
    if (chunk.plain.length === 0) continue;
    try {
      results.push(await sendPlainText(bot, deliveryTarget, chunk.plain, msgSeq));
    } catch (error) {
      if (requireComplete || results.length === 0) throw error;
      await sendPartialNotice();
      break;
    }
  }
  return results;
}
