// Russian translations for host-side user-facing text.
// Keys are the exact Chinese literals passed to t() in src/channels/**.
// This dictionary is a partial overlay: a key missing here is answered from
// ./i18n-en.mjs, never from the Chinese identity key (see t() in ./i18n.mjs).
// Entries are maintained per area in ./i18n-ru/*.mjs and merged here.

import diagnostics from './i18n-ru/diagnostics.mjs';
import imageInput from './i18n-ru/image-input.mjs';
import permission from './i18n-ru/permission.mjs';
import sharedA from './i18n-ru/shared-a.mjs';
import sharedB from './i18n-ru/shared-b.mjs';
import sharedC from './i18n-ru/shared-c.mjs';
import sharedD from './i18n-ru/shared-d.mjs';
import feishu from './i18n-ru/feishu.mjs';
import dingtalk from './i18n-ru/dingtalk.mjs';
import wecom from './i18n-ru/wecom.mjs';
import wecomApp from './i18n-ru/wecom-app.mjs';
import qq from './i18n-ru/qq.mjs';
import weixin from './i18n-ru/weixin.mjs';
import slack from './i18n-ru/slack.mjs';
import telegram from './i18n-ru/telegram.mjs';
import discord from './i18n-ru/discord.mjs';
import whatsapp from './i18n-ru/whatsapp.mjs';
import matrix from './i18n-ru/matrix.mjs';
import office from './i18n-ru/office.mjs';
import email from './i18n-ru/email.mjs';

export const RU = Object.freeze(Object.assign(
  {},
  diagnostics,
  imageInput,
  permission,
  sharedA,
  sharedB,
  sharedC,
  sharedD,
  feishu,
  dingtalk,
  wecom,
  wecomApp,
  qq,
  weixin,
  slack,
  telegram,
  discord,
  whatsapp,
  matrix,
  office,
  email,
));
