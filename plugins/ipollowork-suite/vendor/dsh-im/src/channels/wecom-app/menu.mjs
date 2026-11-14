import { t } from '../shared/i18n.mjs';
import { WecomAppError } from './wecom-app-api.mjs';

const PREFIX = 'ipollo_im_v1_';
const COMMANDS = Object.freeze({ new: '/new', sessions: '/sessionlist', agents: '/presets', models: '/models', status: '/status', stop: '/stop', help: '/help' });

/**
 * Build native bottom-menu buttons; callbacks resolve only this fixed command list.
 * @returns {object} The platform's menu document.
 */
export function wecomAppMenu() {
  const button = (key, label) => ({ type: 'click', name: t(label), key: PREFIX + key });
  return { button: [
    { name: t('会话'), sub_button: [button('new', '新会话'), button('sessions', '会话列表')] },
    { name: t('智能体'), sub_button: [button('agents', '切换智能体'), button('models', '切换模型')] },
    { name: t('操作'), sub_button: [button('status', '查看状态'), button('stop', '停止任务'), button('help', '更多操作')] },
  ] };
}

/**
 * Ignore arbitrary callback text and unknown command keys.
 * @param {string} key Platform click-event key.
 * @returns {string|null} The fixed existing command, or null.
 */
export function wecomAppMenuCommand(key) {
  const name = typeof key === 'string' && key.startsWith(PREFIX) ? key.slice(PREFIX.length) : '';
  return Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
}

/**
 * Create missing menus and update our own; preserve administrator menus.
 * @param {object} api Authenticated application API.
 * @param {AbortSignal} [signal] Runtime cancellation.
 * @returns {Promise<string>} Registered or preserved status; failures reject.
 */
export async function syncWecomAppMenu(api, signal) {
  let current;
  try { current = await api.getMenu({ signal }); }
  catch (error) { if (error?.providerCode !== '46003') throw error; }
  const menu = current?.menu ?? current;
  if (current && !Array.isArray(menu?.button)) throw new WecomAppError('invalid-menu', 'Enterprise WeChat returned an invalid menu');
  const buttons = menu?.button ?? [];
  const owned = entries => Array.isArray(entries) && entries.every(button => button && (button.sub_button?.length
    ? owned(button.sub_button) : button.type === 'click' && wecomAppMenuCommand(button.key)));
  if (buttons.length && !owned(buttons)) return 'preserved';
  const desired = wecomAppMenu();
  if (JSON.stringify({ button: buttons }) !== JSON.stringify(desired)) await api.setMenu(desired, { signal });
  return 'registered';
}
