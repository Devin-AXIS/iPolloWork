import { DiscordLogoGlyph } from '../../channel-logos.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import {
  DISCORD_ENDPOINTS,
  discordClientApi,
} from './api.js';
import { installDiscordStyles } from './styles.js';

const channel = createTokenChannelSettings({
  channel: 'Discord',
  endpoints: DISCORD_ENDPOINTS,
  api: discordClientApi,
  LogoGlyph: DiscordLogoGlyph,
  installStyles: installDiscordStyles,
  pageClass: 'ddc-page',
  avatarClass: 'ddc-avatar',
  connectionLabel: 'Gateway 长连接',
  tokenPlaceholder: '填写 Discord Developer Portal 的 Bot Token',
  emptyTitle: '接入 Discord 机器人',
  emptyDescription: '先在 Developer Portal 创建 Bot 并邀请到服务器，再在这里完成接入。',
  platformLabel: 'Discord Developer Portal',
});

export const DiscordSettingsTab = channel.SettingsTab;
export const DiscordAccountCard = channel.AccountCard;
