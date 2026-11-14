export const FEISHU_GROUP_RESPONSE_MODES = Object.freeze({
  MENTION: 'mention',
  ALL: 'all',
});

export function normalizeFeishuGroupResponseMode(value) {
  return value === FEISHU_GROUP_RESPONSE_MODES.ALL
    ? FEISHU_GROUP_RESPONSE_MODES.ALL
    : FEISHU_GROUP_RESPONSE_MODES.MENTION;
}

export function isFeishuGroupResponseMode(value) {
  return value === FEISHU_GROUP_RESPONSE_MODES.MENTION
    || value === FEISHU_GROUP_RESPONSE_MODES.ALL;
}
