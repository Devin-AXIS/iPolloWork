import { fail } from './media.mjs';

export const now = () => new Date().toISOString();
export function text(value, name, max = 700, required = true) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${name}无效`);
  return value.trim();
}
export function officialUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('请提供微信官方页面地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['channels.weixin.qq.com', 'weixin.qq.com'].includes(url.hostname)) fail('仅支持微信官方页面地址');
  return url.href;
}
export function record(store, kind, id, accountId) {
  const value = store.get(kind, text(id, '记录 ID'));
  if (!value || (accountId && value.accountId !== accountId)) fail('记录不存在或不属于当前账号');
  return value;
}
