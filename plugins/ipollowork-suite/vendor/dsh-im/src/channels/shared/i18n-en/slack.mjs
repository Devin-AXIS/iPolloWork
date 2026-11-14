// English translations (slack area). Keys are exact Chinese literals passed to t().
export default {
  'Slack机器人': 'Slack bot',
  'Slack机器人凭据缺失，请移除后重新接入。':
    'Slack bot credentials are missing. Remove the bot and connect it again.',
  'Slack Socket Mode 连接未就绪，插件会自动重试。':
    'The Slack Socket Mode connection is not ready yet. The plugin will retry automatically.',
  'Slack机器人已接入，Socket Mode 连接暂未就绪。':
    'The Slack bot is connected, but the Socket Mode connection is not ready yet.',
  'Slack Socket Mode 连接仍未就绪，请检查两个 Token。':
    'The Slack Socket Mode connection is still not ready. Check both tokens.',
  'Slack机器人尚未连接': 'The Slack bot is not connected yet',
  'Slack Socket Mode 长连接运行正常':
    'The Slack Socket Mode long-lived connection is running normally',
  'Slack连接未就绪，插件会自动重试':
    'The Slack connection is not ready. The plugin will retry automatically',
  'Slack连接当前离线': 'The Slack connection is currently offline',

  'Slack 未授权机器人读取该文件。请为应用添加 files:read 后重新安装，再重新发送图片。':
    'Slack has not granted the bot access to this file. Add the files:read scope to the app, reinstall it, then send the image again.',
  'Slack Bot Token 必须以 xoxb- 开头。': 'The Slack Bot Token must start with xoxb-.',
  'Slack App Token 必须以 xapp- 开头。': 'The Slack App Token must start with xapp-.',
  'Slack Bot Token 没有返回完整的机器人身份。':
    'The Slack Bot Token did not return a complete bot identity.',
  'Slack App Token 无法创建 Socket Mode 连接，请确认已启用 Socket Mode 和 connections:write。':
    'The Slack App Token could not create a Socket Mode connection. Make sure Socket Mode and connections:write are enabled.',
};
