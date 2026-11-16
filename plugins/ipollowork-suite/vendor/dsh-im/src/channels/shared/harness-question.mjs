import { t } from './i18n.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validHarnessQuestion(question) {
  return question && typeof question.id === 'string' && typeof question.question === 'string'
    && (question.header === undefined || typeof question.header === 'string')
    && (question.detail === undefined || typeof question.detail === 'string')
    && (question.multiSelect === undefined || typeof question.multiSelect === 'boolean')
    && (question.options === undefined || (Array.isArray(question.options)
      && question.options.every((option) => (
        option && typeof option.label === 'string'
        && (option.description === undefined || typeof option.description === 'string')
      ))));
}

/** Render the question prompt. `hasButtons` only swaps the closing hint: the
 * numbered list stays, because a channel whose keyboard fails still answers by text.
 */
export function harnessQuestionText(question, index, total, {
  requiresMention = false,
  hasButtons = false,
} = {}) {
  const lines = [];
  const progress = total > 1 ? `（${index + 1}/${total}）` : '';
  lines.push(t('DeepSeek Harness 需要你补充信息{progress}：', { progress }));
  if (nonEmptyString(question.header)) lines.push('', question.header.trim());
  lines.push('', nonEmptyString(question.question) ?? t('请输入你的回答。'));
  if (nonEmptyString(question.detail)) lines.push('', question.detail.trim());

  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length > 0) {
    lines.push('');
    options.forEach((option, optionIndex) => {
      const label = typeof option?.label === 'string' ? option.label : '';
      const description = nonEmptyString(option?.description);
      lines.push(`${optionIndex + 1}. ${label}${description ? ` — ${description}` : ''}`);
    });
    lines.push('', question.multiSelect === true
      ? t('请回复选项序号或文字；多选用逗号分隔，也可补充其他内容。')
      : hasButtons
        ? t('请点击下方按钮选择，也可直接回复文字。')
        : t('请回复一个选项序号或文字，也可直接输入其他答案。'));
  } else {
    lines.push('', t('请直接回复你的答案。'));
  }
  if (requiresMention) lines.push('', t('群聊中请 @机器人 后发送答案。'));
  return lines.join('\n');
}

function optionLabel(token, options) {
  const normalized = token.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const option = options[Number(normalized) - 1];
    return typeof option?.label === 'string' ? option.label : null;
  }
  const exact = options.find((option) => option?.label === normalized);
  return typeof exact?.label === 'string' ? exact.label : null;
}

export function harnessAnswerForQuestion(question, text) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length === 0) {
    return { id: question.id, selected: [], custom: text };
  }

  const wholeLabel = optionLabel(text, options);
  if (question.multiSelect !== true) {
    return wholeLabel
      ? { id: question.id, selected: [wholeLabel] }
      : { id: question.id, selected: [], custom: text };
  }
  if (wholeLabel) return { id: question.id, selected: [wholeLabel] };

  const selected = [];
  const custom = [];
  for (const token of text.split(/[,，、;；\n]+/)) {
    const value = token.trim();
    if (!value) continue;
    const label = optionLabel(value, options);
    if (label) {
      if (!selected.includes(label)) selected.push(label);
    } else {
      custom.push(value);
    }
  }
  return {
    id: question.id,
    selected,
    ...(custom.length > 0 ? { custom: custom.join('、') } : {}),
  };
}
