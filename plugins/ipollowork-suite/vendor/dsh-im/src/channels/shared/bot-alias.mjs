export const SET_ALIAS_ENDPOINT = 'bot.alias.set';
export const MAX_BOT_ALIAS_LENGTH = 80;

export function validateBotAlias(value) {
  if (typeof value !== 'string' || value.trim().length > MAX_BOT_ALIAS_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('别名不能包含换行或控制字符，且最多 80 个字符。');
  }
  return value.trim();
}

export function normalizeBotAlias(bot) {
  try {
    const alias = validateBotAlias(bot?.alias);
    return alias && typeof bot.originalName === 'string'
      ? { alias, originalName: bot.originalName }
      : {};
  } catch {
    return {};
  }
}

export function withBotAlias(bot, alias) {
  if (!bot) return bot;
  const { originalName = bot.name, alias: _alias, ...rest } = bot;
  return alias
    ? { ...rest, originalName, alias, name: alias }
    : { ...rest, name: originalName };
}
