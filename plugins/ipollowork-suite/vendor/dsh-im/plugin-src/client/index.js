import { callManagementRpc } from '../management-rpc.mjs';
import * as React from 'react';
import manifest from '../../package.json' with { type: 'json' };

import {
  DingtalkLogoGlyph,
  DiscordLogoGlyph,
  FeishuLogoGlyph,
  OfficeLogoGlyph,
  QqLogoGlyph,
  SlackLogoGlyph,
  TelegramLogoGlyph,
  WecomLogoGlyph,
  WeixinLogoGlyph,
  WhatsappLogoGlyph,
  IMessageLogoGlyph,
  EmailLogoGlyph,
  MatrixLogoGlyph,
} from './channel-logos.js';
import { DINGTALK_RPC_CHANNEL } from './channels/dingtalk/api.js';
import { DingtalkSettingsTab } from './channels/dingtalk/index.js';
import { DISCORD_RPC_CHANNEL } from './channels/discord/api.js';
import { DiscordSettingsTab } from './channels/discord/index.js';
import { installDiscordStyles } from './channels/discord/styles.js';
import { FeishuSettingsTab } from './channels/feishu/index.js';
import { FEISHU_RPC_CHANNEL } from './channels/feishu/api.js';
import { installFeishuStyles } from './channels/feishu/styles.js';
import { QQ_RPC_CHANNEL } from './channels/qq/api.js';
import { QqSettingsTab } from './channels/qq/index.js';
import { installQqStyles } from './channels/qq/styles.js';
import { OFFICE_RPC_CHANNEL } from './channels/office/api.js';
import { OfficeSettingsTab } from './channels/office/index.js';
import { installOfficeStyles } from './channels/office/styles.js';
import { SLACK_RPC_CHANNEL } from './channels/slack/api.js';
import { SlackSettingsTab } from './channels/slack/index.js';
import { installSlackStyles } from './channels/slack/styles.js';
import { TELEGRAM_RPC_CHANNEL } from './channels/telegram/api.js';
import { TelegramSettingsTab } from './channels/telegram/index.js';
import { installTelegramStyles } from './channels/telegram/styles.js';
import { WECOM_RPC_CHANNEL } from './channels/wecom/api.js';
import { WecomSettingsTab } from './channels/wecom/index.js';
import { installWecomStyles } from './channels/wecom/styles.js';
import { WECOM_APP_RPC_CHANNEL } from './channels/wecom-app/api.js';
import { WecomAppSettingsTab } from './channels/wecom-app/index.js';
import { installWecomAppStyles } from './channels/wecom-app/styles.js';
import { WeixinSettingsTab } from './channels/weixin/index.js';
import { WEIXIN_RPC_CHANNEL } from './channels/weixin/api.js';
import { installWeixinStyles } from './channels/weixin/styles.js';
import { WHATSAPP_RPC_CHANNEL } from './channels/whatsapp/api.js';
import { WhatsappSettingsTab } from './channels/whatsapp/index.js';
import { installWhatsappStyles } from './channels/whatsapp/styles.js';
import { IMESSAGE_RPC_CHANNEL } from './channels/imessage/api.js';
import { EMAIL_RPC_CHANNEL } from './channels/email/api.js';
import { IMessageSettingsTab } from './channels/imessage/index.js';
import { EmailSettingsTab, useEmailChannelEnabled } from './channels/email/index.js';
import { installIMessageStyles } from './channels/imessage/styles.js';
import { installEmailStyles } from './channels/email/styles.js';
import { MATRIX_RPC_CHANNEL } from './channels/matrix/api.js';
import { MatrixSettingsTab } from './channels/matrix/index.js';
import { installMatrixStyles } from './channels/matrix/styles.js';
import { en, h, IM_LOCALE_NAMESPACE, installImRussianLocale, setImTranslator, zh } from './i18n.js';
import {
  HOST_LANGUAGE_RPC_CHANNEL,
  installInterfaceLanguageMirror,
} from './interface-language.js';
import { BotSettingsContext } from './channel-card-meta.js';
import {
  DELIVERY_RPC_CHANNEL,
  DeliveryTargetSettingsPage,
} from './delivery-settings.js';
import {
  GLOBAL_SETTINGS_RPC_CHANNEL,
  GLOBAL_SETTINGS_TAB_ID,
  GlobalSettingsLogoGlyph,
  GlobalSettingsPanel,
} from './global-settings.js';
import {
  createLoopbackAwareRpcCalls,
  replacePageLocation,
} from './loopback-recovery.js';
import { installImStyles } from './styles.js';
import { DELIVERY_SYNC_SETTINGS_RPC_CHANNEL } from './delivery-sync-settings.js';
import { installSessionChannelLogos } from './session-channel-logos.js';
import { installDsBotSessionAvatars } from './ds-bot-session-avatars.js';
import { WorkspaceDirectoryPickerContext } from './workspace-editor.js';
import { IMPanelErrorBoundary } from './panel-error-boundary.js';
import { installImPluginPage } from './plugin-page.js';
import { installSidebarVisibilitySync, SIDEBAR_SETTINGS_ENDPOINTS, SIDEBAR_SETTINGS_RPC_CHANNEL } from './sidebar-settings.js';

import { installChannelSessionsPage, CHANNEL_LIST_RPC_CHANNEL } from './im-channels.js';
export const name = 'im-settings';
export const inject = ['slots', 'connection', 'locale', 'workspaces'];
export const IM_PLUGIN_VERSION = manifest.version;

function callWorkspaceDirectoryApi(ctx, method, ...args) {
  // Current DSH owns directory operations on uiWorkspace; legacy Hosts keep them on workspaces.
  const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
  const service = typeof uiWorkspace?.[method] === 'function' ? uiWorkspace : ctx.workspaces;
  if (typeof service?.[method] !== 'function') {
    throw new Error('无法读取目录，请重试。');
  }
  return service[method](...args);
}

const CHANNELS = Object.freeze([
  { id: 'weixin', label: '微信' },
  { id: 'feishu', label: '飞书' },
  { id: 'dingtalk', label: '钉钉' },
  { id: 'wecom', label: '企业微信' },
  { id: 'qq', label: 'QQ' },
  { id: 'slack', label: 'Slack' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'discord', label: 'Discord' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'wecomApp', label: '企业微信应用', note: '（实验功能）' },
  { id: 'imessage', label: 'iMessage', note: '（实验功能）' },
  { id: 'email', label: '邮箱', note: '（实验功能）' },
  { id: 'matrix', label: 'Matrix', note: '（实验功能）' },
  { id: 'office', label: 'AI Office', note: '（实验功能）' },
]);

function WeixinLogo() {
  return h('span', { className: 'dim-logo dim-logoWeixin', 'aria-hidden': 'true' },
    h(WeixinLogoGlyph));
}

function FeishuLogo() {
  return h('span', { className: 'dim-logo dim-logoFeishu', 'aria-hidden': 'true' },
    h(FeishuLogoGlyph));
}

function DingtalkLogo() {
  return h('span', { className: 'dim-logo dim-logoDingtalk', 'aria-hidden': 'true' },
    h(DingtalkLogoGlyph));
}

function QqLogo() {
  return h('span', { className: 'dim-logo dim-logoQq', 'aria-hidden': 'true' }, h(QqLogoGlyph));
}

function WecomLogo() {
  return h('span', { className: 'dim-logo dim-logoWecom', 'aria-hidden': 'true' }, h(WecomLogoGlyph));
}

function WecomAppLogo() {
  return h('span', { className: 'dim-logo dim-logoWecomApp', 'aria-hidden': 'true' }, h(WecomLogoGlyph));
}

function TelegramLogo() {
  return h('span', { className: 'dim-logo dim-logoTelegram', 'aria-hidden': 'true' },
    h(TelegramLogoGlyph));
}

function SlackLogo() {
  return h('span', { className: 'dim-logo dim-logoSlack', 'aria-hidden': 'true' },
    h(SlackLogoGlyph));
}

function DiscordLogo() {
  return h('span', { className: 'dim-logo dim-logoDiscord', 'aria-hidden': 'true' },
    h(DiscordLogoGlyph));
}

function WhatsappLogo() {
  return h('span', { className: 'dim-logo dim-logoWhatsapp', 'aria-hidden': 'true' },
    h(WhatsappLogoGlyph));
}

function IMessageLogo() {
  return h('span', { className: 'dim-logo dim-logoIMessage', 'aria-hidden': 'true' },
    h(IMessageLogoGlyph));
}

function EmailLogo() {
  return h('span', { className: 'dim-logo dim-logoEmail', 'aria-hidden': 'true' },
    h(EmailLogoGlyph));
}

function MatrixLogo() {
  return h('span', { className: 'dim-logo dim-logoMatrix', 'aria-hidden': 'true' },
    h(MatrixLogoGlyph));
}

function OfficeLogo() {
  return h('span', { className: 'dim-logo dim-logoOffice', 'aria-hidden': 'true' },
    h(OfficeLogoGlyph));
}

function ChannelLogo({ channel }) {
  if (channel === 'weixin') return h(WeixinLogo);
  if (channel === 'feishu') return h(FeishuLogo);
  if (channel === 'dingtalk') return h(DingtalkLogo);
  if (channel === 'wecom') return h(WecomLogo);
  if (channel === 'wecomApp') return h(WecomAppLogo);
  if (channel === 'qq') return h(QqLogo);
  if (channel === 'slack') return h(SlackLogo);
  if (channel === 'telegram') return h(TelegramLogo);
  if (channel === 'discord') return h(DiscordLogo);
  if (channel === 'whatsapp') return h(WhatsappLogo);
  if (channel === 'imessage') return h(IMessageLogo);
  if (channel === 'email') return h(EmailLogo);
  if (channel === 'matrix') return h(MatrixLogo);
  return h(OfficeLogo);
}

export function LoopbackRecoveryNotice({ recovery, onNavigate = replacePageLocation }) {
  return h('div', {
    className: 'dim-loopbackRecovery',
    role: 'alert',
  },
  h('div', { className: 'dim-loopbackRecoveryCopy' },
    h('strong', null, '请改用 localhost 重新打开'),
    h('p', null, '页面会在当前端口重新打开，机器人配置不会改变。'),
    h('code', null, recovery.origin)),
  h('button', {
    type: 'button',
    className: 'dim-loopbackRecoveryAction',
    onClick: () => onNavigate(recovery.url),
  }, '使用 localhost 重新打开'));
}

export function IMSettingsTab({
  dingtalkRpcCall,
  discordRpcCall,
  feishuRpcCall,
  imessageRpcCall,
  emailRpcCall,
  matrixRpcCall,
  qqRpcCall,
  slackRpcCall,
  telegramRpcCall,
  wecomRpcCall,
  wecomAppRpcCall,
  weixinRpcCall,
  whatsappRpcCall,
  officeRpcCall,
  deliveryRpcCall,
  globalSettingsRpcCall,
  deliverySyncRpcCall,
  languageRpcCall,
  workspaceDirectoryPicker,
  onOpenSessionHistory,
  preferredSectionId,
  browserLocation = globalThis.location,
  navigateToRecoveryUrl = replacePageLocation,
}) {
  const [selected, setSelected] = React.useState(() => (
    preferredSectionId === GLOBAL_SETTINGS_TAB_ID
      || CHANNELS.some((channel) => channel.id === preferredSectionId)
      ? preferredSectionId : 'weixin'
  ));
  const [loopbackRecovery, setLoopbackRecovery] = React.useState(null);
  const runningVersion = IM_PLUGIN_VERSION;
  const [deliverySettings, setDeliverySettings] = React.useState(null);
  // The Host owns email availability and reports it over RPC. The
  // mailbox entry point is omitted entirely while it is closed, and the visible
  // channel list is what every later lookup (active tab, rail) reads from.
  const emailEnabled = useEmailChannelEnabled(emailRpcCall);
  const visibleChannels = React.useMemo(
    () => CHANNELS.filter((channel) => channel.id !== 'email' || emailEnabled),
    [emailEnabled],
  );
  const githubTooltipId = React.useId();
  const sessionHistoryTooltipId = React.useId();
  const generalSettingsTooltipId = React.useId();
  const globalSettingsSelected = selected === GLOBAL_SETTINGS_TAB_ID;
  const active = visibleChannels.find((channel) => channel.id === selected) ?? visibleChannels[0];
  const activeTabId = globalSettingsSelected
    ? 'dim-general-settings-trigger'
    : `dim-tab-${active.id}`;
  const activePanelId = globalSettingsSelected
    ? `dim-panel-${GLOBAL_SETTINGS_TAB_ID}`
    : `dim-panel-${active.id}`;
  const reportLoopbackRecovery = React.useCallback((recovery) => {
    setLoopbackRecovery((current) => current?.url === recovery.url ? current : recovery);
  }, []);
  const rpcCalls = React.useMemo(() => createLoopbackAwareRpcCalls({
    dingtalkRpcCall,
    discordRpcCall,
    feishuRpcCall,
    qqRpcCall,
    slackRpcCall,
    telegramRpcCall,
    wecomRpcCall,
    wecomAppRpcCall,
    weixinRpcCall,
    whatsappRpcCall,
    officeRpcCall,
      deliveryRpcCall,
    globalSettingsRpcCall,
    deliverySyncRpcCall,
    languageRpcCall,
    imessageRpcCall,
    emailRpcCall,
    matrixRpcCall,
  }, {
    location: browserLocation,
    onRecovery: reportLoopbackRecovery,
  }), [
    browserLocation,
    dingtalkRpcCall,
    discordRpcCall,
    deliveryRpcCall,
    feishuRpcCall,
    globalSettingsRpcCall,
    deliverySyncRpcCall,
    imessageRpcCall,
    emailRpcCall,
    matrixRpcCall,
    officeRpcCall,
    qqRpcCall,
    reportLoopbackRecovery,
    slackRpcCall,
    telegramRpcCall,
      wecomRpcCall,
    wecomAppRpcCall,
    weixinRpcCall,
    whatsappRpcCall,
  ]);
  const botSettingsContext = React.useMemo(() => Object.freeze({
    openBotSettings: setDeliverySettings,
  }), []);
  return h(WorkspaceDirectoryPickerContext.Provider, { value: workspaceDirectoryPicker },
    h('section', { className: 'dim-page', 'aria-label': 'IM机器人设置' },
    h('header', { className: 'dim-title' },
      h('div', { className: 'dim-brand' },
        h('div', { className: 'dim-brandHeading' },
          h('strong', { className: 'dim-brandName' }, 'iPolloWork IM'),
          h('span', { className: 'dim-brandVersion' }, `v${runningVersion}`)),
        h('p', null, '让 DeepSeek Harness 触手可及')),
      h('div', { className: 'dim-titleActions' },
      h('span', { className: 'dim-githubAction' },
        h('a', {
          className: 'dim-githubLink',
          href: 'https://github.com/xmanrui/dsh-im',
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': 'dsh-im GitHub',
          'aria-describedby': githubTooltipId,
        },
        h('svg', {
          width: 18,
          height: 18,
          viewBox: '0 0 16 16',
          fill: 'currentColor',
          focusable: 'false',
          'aria-hidden': 'true',
        }, h('path', {
          d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z',
        }))),
        h('span', {
          id: githubTooltipId,
          className: 'dim-githubTooltip',
          role: 'tooltip',
        }, '帮助与反馈 · 前往 GitHub')),
      onOpenSessionHistory ? h('span', { className: 'dim-sessionHistoryAction' },
        h('button', {
          type: 'button',
          className: 'dim-sessionHistoryButton',
          'aria-label': '会话记录',
          'aria-describedby': sessionHistoryTooltipId,
          onClick: onOpenSessionHistory,
        }, h('svg', {
          width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
          focusable: 'false', 'aria-hidden': 'true',
        },
        h('path', { d: 'M21 15a3 3 0 0 1-3 3H7l-4 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z' }),
        h('path', { d: 'M8 8h8M8 12h5' }))),
        h('span', {
          id: sessionHistoryTooltipId,
          className: 'dim-sessionHistoryTooltip',
          role: 'tooltip',
        }, '会话记录')) : null,
      h('span', { className: 'dim-generalSettingsAction' },
        h('button', {
          type: 'button',
          id: 'dim-general-settings-trigger',
          className: 'dim-generalSettingsButton',
          'aria-label': '通用设置',
          'aria-describedby': generalSettingsTooltipId,
          'aria-controls': `dim-panel-${GLOBAL_SETTINGS_TAB_ID}`,
          'aria-current': globalSettingsSelected ? 'page' : undefined,
          onClick: () => {
            setSelected(GLOBAL_SETTINGS_TAB_ID);
            setDeliverySettings(null);
          },
        }, h(GlobalSettingsLogoGlyph, { size: 17 })),
        h('span', {
          id: generalSettingsTooltipId,
          className: 'dim-generalSettingsTooltip',
          role: 'tooltip',
        }, '通用设置'))),
    ),
    h('div', { className: 'dim-layout' },
      h('nav', { className: 'dim-rail', role: 'tablist', 'aria-label': 'IM 设置导航' },
        visibleChannels.map((channel) => h('button', {
          key: channel.id,
          type: 'button',
          role: 'tab',
          id: `dim-tab-${channel.id}`,
          className: 'dim-channel',
          'aria-selected': !globalSettingsSelected && channel.id === active.id,
          'aria-controls': `dim-panel-${channel.id}`,
          onClick: () => {
            setSelected(channel.id);
            setDeliverySettings(null);
          },
        },
        h(ChannelLogo, { channel: channel.id }),
        h('span', { className: 'dim-channelCopy' },
          h('strong', null, channel.label),
          channel.note ? h('small', { className: 'dim-channelNote' }, channel.note) : null,
        )))),
      h('div', { className: 'dim-divider', 'aria-hidden': 'true' }),
      h('main', {
        className: 'dim-panel',
        role: 'tabpanel',
        id: activePanelId,
        'aria-labelledby': activeTabId,
      },
      loopbackRecovery
        ? h(LoopbackRecoveryNotice, {
            recovery: loopbackRecovery,
            onNavigate: navigateToRecoveryUrl,
          })
        : null,
      h(BotSettingsContext.Provider, { value: botSettingsContext },
        globalSettingsSelected
          ? h(GlobalSettingsPanel, {
              rpcCall: rpcCalls.globalSettingsRpcCall,
              deliverySyncRpcCall: rpcCalls.deliverySyncRpcCall,
              languageRpcCall: rpcCalls.languageRpcCall,
            })
          : deliverySettings?.channel === active.id
          ? h(DeliveryTargetSettingsPage, {
              channel: active.id,
              account: deliverySettings,
              rpcCall: rpcCalls.deliveryRpcCall,
              accessRpcCall: rpcCalls[`${active.id}RpcCall`],
              onBack: () => setDeliverySettings(null),
            })
          : active.id === 'weixin'
            ? h(WeixinSettingsTab, { rpcCall: rpcCalls.weixinRpcCall })
            : active.id === 'feishu'
              ? h(FeishuSettingsTab, { rpcCall: rpcCalls.feishuRpcCall })
              : active.id === 'dingtalk'
                ? h(DingtalkSettingsTab, { rpcCall: rpcCalls.dingtalkRpcCall })
                : active.id === 'wecom'
                  ? h(WecomSettingsTab, { rpcCall: rpcCalls.wecomRpcCall })
                : active.id === 'wecomApp'
                  ? h(WecomAppSettingsTab, { rpcCall: rpcCalls.wecomAppRpcCall })
                  : active.id === 'qq'
                    ? h(QqSettingsTab, { rpcCall: rpcCalls.qqRpcCall })
                    : active.id === 'slack'
                      ? h(SlackSettingsTab, { rpcCall: rpcCalls.slackRpcCall })
                    : active.id === 'telegram'
                      ? h(TelegramSettingsTab, { rpcCall: rpcCalls.telegramRpcCall })
                      : active.id === 'discord'
                        ? h(DiscordSettingsTab, { rpcCall: rpcCalls.discordRpcCall })
                        : active.id === 'whatsapp'
                          ? h(WhatsappSettingsTab, { rpcCall: rpcCalls.whatsappRpcCall })
                          : active.id === 'imessage'
                            ? h(IMessageSettingsTab, { rpcCall: rpcCalls.imessageRpcCall })
                          : active.id === 'email'
                            ? h(EmailSettingsTab, { rpcCall: rpcCalls.emailRpcCall })
                          : active.id === 'matrix'
                            ? h(MatrixSettingsTab, { rpcCall: rpcCalls.matrixRpcCall })
                          : h(OfficeSettingsTab, { rpcCall: rpcCalls.officeRpcCall }))),
    ),
  ));
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(IM_LOCALE_NAMESPACE, { zh, en }),
    'im-settings: bilingual dictionaries',
  );
  // Russian is a language pack rather than a built-in locale: it needs its own
  // definition so it shows up in the Language row, and its lookups chain to
  // English before falling back to the Chinese key itself.
  ctx.effect(
    () => installImRussianLocale(ctx.locale),
    'im-settings: Russian language pack',
  );
  const t = ctx.locale.bind(IM_LOCALE_NAMESPACE);
  setImTranslator(t);

  // The settings page is the only place that knows the locale the interface is
  // actually rendered in: DSH stores nothing when it came from the browser's
  // language list. Report it so bot messages follow the same language.
  ctx.effect(
    () => installInterfaceLanguageMirror(ctx, {
      rpcCall: (endpoint, payload, signal) =>
        callManagementRpc(ctx.connection, HOST_LANGUAGE_RPC_CHANNEL, endpoint, payload, signal),
    }),
    'im-settings: mirror the DSH interface language',
  );

  ctx.effect(() => installSessionChannelLogos(), 'im-settings: Session channel logos');
  let dsBotAvatars;
  ctx.effect(() => {
    dsBotAvatars = installDsBotSessionAvatars(ctx, {
      rpcCall: (endpoint, payload, signal) =>
        callManagementRpc(ctx.connection, DELIVERY_RPC_CHANNEL, endpoint, payload, signal),
    });
    return () => { dsBotAvatars.dispose(); dsBotAvatars = null; };
  }, 'im-settings: bound DS Bot session avatars');

  ctx.effect(() => {
    const disposers = [
      installFeishuStyles(),
      installWeixinStyles(),
      installWecomStyles(),
      installWecomAppStyles(),
      installQqStyles(),
      installSlackStyles(),
      installTelegramStyles(),
      installDiscordStyles(),
      installWhatsappStyles(),
      installIMessageStyles(),
      installEmailStyles(),
      installMatrixStyles(),
      installOfficeStyles(),
      installImStyles(),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  }, 'im-settings: install combined channel styles');

  let sidebarSync;
  const managementRpc = async (connection, channel, endpoint, payload, signal) => {
    const result = await callManagementRpc(connection, channel, endpoint, payload, signal);
    if (result?.ok === true) {
      const dsBotRead = channel === DELIVERY_RPC_CHANNEL && endpoint === 'ds-bot.status';
      if (channel === DELIVERY_RPC_CHANNEL && ['ds-bot.bind', 'ds-bot.unbind'].includes(endpoint)) dsBotAvatars?.refresh();
      if (endpoint === SIDEBAR_SETTINGS_ENDPOINTS.set) sidebarSync?.apply(result);
      else if (!dsBotRead && endpoint !== SIDEBAR_SETTINGS_ENDPOINTS.get) sidebarSync?.refresh();
    }
    return result;
  };
  const feishuRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, FEISHU_RPC_CHANNEL, endpoint, payload, signal);
  const weixinRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, WEIXIN_RPC_CHANNEL, endpoint, payload, signal);
  const dingtalkRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, DINGTALK_RPC_CHANNEL, endpoint, payload, signal);
  const qqRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, QQ_RPC_CHANNEL, endpoint, payload, signal);
  const wecomRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, WECOM_RPC_CHANNEL, endpoint, payload, signal);
  const wecomAppRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, WECOM_APP_RPC_CHANNEL, endpoint, payload, signal);
  const telegramRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, TELEGRAM_RPC_CHANNEL, endpoint, payload, signal);
  const discordRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, DISCORD_RPC_CHANNEL, endpoint, payload, signal);
  const whatsappRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, WHATSAPP_RPC_CHANNEL, endpoint, payload, signal);
  const imessageRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, IMESSAGE_RPC_CHANNEL, endpoint, payload, signal);
  const emailRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, EMAIL_RPC_CHANNEL, endpoint, payload, signal);
  const matrixRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, MATRIX_RPC_CHANNEL, endpoint, payload, signal);
  const slackRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, SLACK_RPC_CHANNEL, endpoint, payload, signal);
  const officeRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, OFFICE_RPC_CHANNEL, endpoint, payload, signal);
  const deliveryRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, DELIVERY_RPC_CHANNEL, endpoint, payload, signal);
  const globalSettingsRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, Object.values(SIDEBAR_SETTINGS_ENDPOINTS).includes(endpoint)
      ? SIDEBAR_SETTINGS_RPC_CHANNEL : GLOBAL_SETTINGS_RPC_CHANNEL, endpoint, payload, signal);
  const deliverySyncRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, DELIVERY_SYNC_SETTINGS_RPC_CHANNEL, endpoint, payload, signal);
  const languageRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, HOST_LANGUAGE_RPC_CHANNEL, endpoint, payload, signal);
  const channelListRpcCall = (endpoint, payload, signal) =>
    managementRpc(ctx.connection, CHANNEL_LIST_RPC_CHANNEL, endpoint, payload, signal);
  const workspaceDirectoryPicker = Object.freeze({
    listDirectory: (path, signal) =>
      callWorkspaceDirectoryApi(ctx, 'listDirectory', path, signal),
    pickDirectory: () => callWorkspaceDirectoryApi(ctx, 'pickDirectory'),
  });

  const panelDependencies = {
    dingtalkRpcCall,
    discordRpcCall,
    feishuRpcCall,
    qqRpcCall,
    slackRpcCall,
    telegramRpcCall,
    wecomRpcCall,
    wecomAppRpcCall,
    weixinRpcCall,
    whatsappRpcCall,
    imessageRpcCall,
    officeRpcCall,
    emailRpcCall,
    matrixRpcCall,
      deliveryRpcCall,
    globalSettingsRpcCall,
    languageRpcCall,
    deliverySyncRpcCall,
    channelListRpcCall,
    workspaceDirectoryPicker,
  };
  const subscribeLocale = (listener) => typeof ctx.on === 'function'
    ? ctx.on('locale/change', listener) : () => {};
  const localeSnapshot = () => ctx.locale.getLocale?.()?.active ?? '';

  // Stable for this plugin lifetime: creating an element must not create a
  // new component type and reset the reader's selected tab or unsaved input.
  function IMPanel({ preferredSectionId }) {
    React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
    const historyAvailable = React.useSyncExternalStore(
      channelSessionsPage.subscribe, channelSessionsPage.available, channelSessionsPage.available,
    );
    return h(IMPanelErrorBoundary, null,
      h(IMSettingsTab, {
        ...panelDependencies, preferredSectionId,
        onOpenSessionHistory: historyAvailable ? channelSessionsPage.open : undefined,
      }));
  }
  const buildPanelElement = (props = {}) => h(IMPanel, {
    preferredSectionId: props.preferredSectionId,
  });

  const pluginPage = installImPluginPage(ctx, {
    packageName: manifest.name,
    renderPanel: buildPanelElement,
  });
  const channelSessionsPage = installChannelSessionsPage(ctx, { channelListRpcCall });

  ctx.effect(() => {
    sidebarSync = installSidebarVisibilitySync({
      rpcCall: (endpoint, payload, signal) =>
        callManagementRpc(ctx.connection, SIDEBAR_SETTINGS_RPC_CHANNEL, endpoint, payload, signal),
      setVisible: (visible) => pluginPage.setSidebarVisible(visible),
    });
    return () => { sidebarSync.dispose(); sidebarSync = null; };
  }, 'im-settings: sidebar visibility');

  ctx.effect(() => {
    let disposed = false;
    let stopSettings = null;
    let registered = false;
    const setSettingsVisible = (visible) => {
      if (disposed) return;
      if (typeof visible !== 'boolean') throw new TypeError('visible must be a boolean');
      if (visible === (stopSettings !== null)) return;
      if (!visible) {
        const stop = stopSettings;
        stopSettings = null;
        stop();
        return;
      }
      // The existing slot controller owns late declarations, withdrawal and
      // re-declaration. Cancelling it also cancels a pending registration.
      stopSettings = ctx.slots.inject('settings.section', () => {
        const unregister = ctx.slots.register({
          name: 'settings.section',
          id: 'ipollowork-im',
          order: 21,
          label: () => t('IM机器人'),
          locale: IM_LOCALE_NAMESPACE,
          inject: () => panelDependencies,
        }, buildPanelElement);
        registered = true;
        return () => {
          registered = false;
          unregister();
        };
      });
    };

    // Publish only after the default registration is established, so a
    // consumer hiding it during service discovery cannot be overridden.
    setSettingsVisible(true);
    if (typeof ctx.provide === 'function') {
      ctx.provide('dshImClient', Object.freeze({
        version: 1,
        render: (props) => disposed ? null : buildPanelElement(props),
        setSettingsVisible,
        settingsVisible: () => !disposed && registered,
      }));
    }
    return () => {
      disposed = true;
      const stop = stopSettings;
      stopSettings = null;
      registered = false;
      stop?.();
    };
  }, 'im-settings: client panel service');
}
