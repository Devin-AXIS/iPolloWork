export const SESSION_CHANNEL_LABELS = Object.freeze(Object.fromEntries(Object.entries({
  weixin: ['微信', 'WeChat'],
  feishu: ['飞书', 'Feishu'],
  dingtalk: ['钉钉', 'DingTalk'],
  wecom: ['企业微信', 'WeCom'],
  qq: ['QQ', 'QQ'],
  slack: ['Slack', 'Slack'],
  telegram: ['Telegram', 'Telegram'],
  discord: ['Discord', 'Discord'],
  whatsapp: ['WhatsApp', 'WhatsApp'],
  imessage: ['iMessage', 'iMessage'],
  matrix: ['Matrix', 'Matrix'],
  office: ['AI Office', 'AI Office'],
}).map(([channel, labels]) => [channel, Object.freeze(labels)])));

/** Read only the exact, leading title prefix emitted by dsh-im. */
export function parseSessionChannelTitle(title) {
  if (typeof title !== 'string') return null;
  for (const [channel, labels] of Object.entries(SESSION_CHANNEL_LABELS)) {
    for (const label of labels) {
      const prefix = `${label} · `;
      if (title.startsWith(prefix) && title.slice(prefix.length).trim()) {
        return { channel, title: title.slice(prefix.length) };
      }
    }
  }
  return null;
}
