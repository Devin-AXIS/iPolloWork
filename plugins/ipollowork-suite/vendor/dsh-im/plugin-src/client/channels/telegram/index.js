import { TelegramLogoGlyph } from '../../channel-logos.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import {
  TELEGRAM_ENDPOINTS,
  telegramClientApi,
} from './api.js';
import { ThinkingTracesSettings } from './thinking-traces.js';
import { installTelegramStyles } from './styles.js';

const channel = createTokenChannelSettings({
  channel: 'Telegram',
  endpoints: TELEGRAM_ENDPOINTS,
  api: telegramClientApi,
  LogoGlyph: TelegramLogoGlyph,
  installStyles: installTelegramStyles,
  pageClass: 'dtg-page',
  avatarClass: 'dtg-avatar',
  connectionLabel: 'Bot API 长轮询',
  tokenPlaceholder: '填写 @BotFather 生成的 Bot Token',
  emptyTitle: '接入 Telegram 机器人',
  emptyDescription: '先通过 @BotFather 获取 Bot Token，再在这里完成接入。',
  platformLabel: 'Telegram',
  AccountSettings: ThinkingTracesSettings,
  accountSettingsEndpoint: 'bot.thinking-traces.set',
});

export const TelegramSettingsTab = channel.SettingsTab;
export const TelegramAccountCard = channel.AccountCard;
