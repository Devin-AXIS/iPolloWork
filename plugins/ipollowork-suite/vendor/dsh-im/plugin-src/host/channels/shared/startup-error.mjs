import { t } from '../../../../src/channels/shared/i18n.mjs';

const CHANNEL_NAMES = {
  weixin: '微信', feishu: '飞书', dingtalk: '钉钉', wecom: '企业微信',
  'wecom-app': '企业微信应用', qq: 'QQ', slack: 'Slack', telegram: 'Telegram',
  discord: 'Discord', whatsapp: 'WhatsApp', imessage: 'iMessage',
  email: '邮箱', matrix: 'Matrix', office: 'AI Office',
};
const INVALID_CONFIG_MESSAGES = new Set([
  'dsh-weixin config contains invalid account data',
  'dsh-feishu config contains an invalid bot entry',
  'dsh-feishu config contains duplicate bot identities',
  'dsh-feishu config is incomplete or invalid',
  'dsh-dingtalk config contains invalid bot data',
  ...['Enterprise WeChat', 'Enterprise WeChat app', 'QQ', 'Slack', 'Telegram', 'Discord', 'Email']
    .map(channel => `dsh-im ${channel} config contains invalid bot data`),
  'dsh-im WhatsApp config contains invalid account data',
  'dsh-im Matrix config contains invalid bot data',
  'dsh-im AI Office config is invalid',
  'dsh-im workspace config is invalid',
]);

export function publicChannelInitializing(channel) {
  return {
    code: `${channel}-initializing`,
    message: t('{channel}正在初始化，请稍后重新读取。', { channel: t(CHANNEL_NAMES[channel]) }),
    details: {},
  };
}

/** Only public guidance crosses RPC; parser excerpts, paths and secrets stay in logs. */
export function publicChannelStartupError(channel, error) {
  const params = { channel: t(CHANNEL_NAMES[channel]), id: channel };
  if (error instanceof SyntaxError || INVALID_CONFIG_MESSAGES.has(error?.message)) {
    return {
      code: `${channel}-startup-config-invalid`,
      message: channel === 'office'
        ? t('{channel}配置格式错误。请检查其数据目录中的 config.json，修复后重启 DSH。详细原因请查看启动日志。', params)
        : t('{channel}配置格式错误。请检查其数据目录中的 config.json 和 workspaces.json，修复后重启 DSH。详细原因请查看启动日志。', params),
      details: {},
    };
  }
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return {
      code: `${channel}-startup-permission-denied`,
      message: t('无法读取或写入{channel}配置。请检查其数据目录的访问权限，修复后重启 DSH。详细原因请查看启动日志。', params),
      details: {},
    };
  }
  return {
    code: `${channel}-startup-failed`,
    message: t('{channel}初始化失败。请展开诊断详情，并通过参考号查找 DSH 启动日志，修复后重启 DSH。', params),
    details: {},
  };
}
