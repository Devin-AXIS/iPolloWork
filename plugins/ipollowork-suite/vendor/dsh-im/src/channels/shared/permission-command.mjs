import { isSessionNotFound } from './session-error.mjs';
import { createCommandListSnapshots } from './command-list-snapshots.mjs';
import { t } from './i18n.mjs';
import { withSessionBindingLock } from './session-binding-lock.mjs';
import { splitWorkspaceCommandMessage } from './workspace-command.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

const COMMAND = /^\/(?:permission|permissionlist)(?=$|\s)/iu;
const SNAPSHOTS = createCommandListSnapshots();
const USAGE = '用法：/permission 查看当前权限；/permissionlist 列出档位；/permission <序号或完整ID> 切换；纯数字 ID 使用 /permission id:<ID>。';
const SCOPE = '仅影响当前会话；沙箱与审批策略会同时按 Host 的档位定义更新。';
const REFRESH = '请先执行 /permissionlist，再按列表序号选择权限档位。';
const validId = (id) => typeof id === 'string' && /^[^\s\p{Cc}\p{Cf}]+$/u.test(id);
const display = (value) => typeof value === 'string'
  ? value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim() : '';

function result(message) {
  return { handled: true, message, messages: splitWorkspaceCommandMessage(message) };
}

function permissions(value) {
  if (!value || !validId(value.currentValue) || !Array.isArray(value.options)
    || value.options.some((item) => !item || !validId(item.value))) {
    throw new TypeError('Harness returned invalid permissions');
  }
  const seen = new Set();
  return {
    currentValue: value.currentValue,
    options: value.options.filter((item) => {
      if (item.value === 'custom' || seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    }),
  };
}

function description(item) {
  // Translate known Host copy, not an assumed ID -> policy mapping: presets are configurable.
  const text = display(item.description);
  if (text === 'Full file access without approval prompts.') {
    return t('完全文件访问，不再请求审批。');
  }
  if (text === 'Write inside the workspace and permitted temporary directories; wider retries require approval.') {
    return t('可写工作区和允许的临时目录；扩大访问范围需要审批。');
  }
  return text;
}

function errorMessage(error, writing) {
  const code = error?.code ?? error?.failure?.code;
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，请重试。');
  }
  if (isSessionNotFound(code) || code === 'agent-not-found') {
    return t('当前聊天绑定的会话已不存在，请先绑定或建立会话。');
  }
  if (['commands-unavailable', 'permissions-unavailable', 'harness-api-not-found',
    'endpoint-not-found', 'gateway/endpoint-not-found'].includes(code)) {
    return t('当前 Host 暂不支持从机器人查看或切换权限档位。');
  }
  return writing
    ? t('未能确认权限切换结果，请执行 /permission 核对当前档位。')
    : t('暂时无法获取权限档位，请稍后重试。');
}

export function isPermissionCommand(text) {
  return typeof text === 'string' && COMMAND.test(text.trim());
}

export async function runPermissionCommand(text, harness, state, key, options = {}) {
  if (!isPermissionCommand(text)) return null;
  if (options.hasImages || options.hasFiles) {
    return result(t('权限命令仅支持纯文字，请移除图片或文件后重试。'));
  }
  const match = /^\/(permission|permissionlist)(?:[ \t]+([^\s]+))?[ \t]*$/iu.exec(text.trim());
  if (!match || (match[1].toLowerCase() === 'permissionlist' && match[2])) return result(t(USAGE));
  const list = match[1].toLowerCase() === 'permissionlist';
  const requested = match[2];
  if (requested && (!validId(requested) || requested.startsWith('--'))) return result(t(USAGE));
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  let writing = false;
  try {
    return await withSessionBindingLock(state, key, async () => {
      signal.throwIfAborted();
      const sessionId = state.sessionFor?.(key);
      if (!sessionId) return result(t('当前聊天尚未绑定会话，请先发送普通消息建立会话，或使用 /session 绑定已有会话。'));
      const session = typeof harness.workspaceSession === 'function'
        ? harness.workspaceSession(sessionId, key)
        : {
            permissions: harness.getSessionPermissions && ((opts) => harness.getSessionPermissions(sessionId, opts)),
            executeCommand: harness.executeCommand && ((line, opts) => harness.executeCommand(sessionId, line, opts)),
          };
      if (!requested) {
        if (typeof session?.permissions !== 'function') return result(t('当前 Host 暂不支持从机器人查看或切换权限档位。'));
        const current = permissions(await session.permissions({ signal }));
        if (state.sessionFor(key) !== sessionId) return result(t('当前会话已变化，请重新执行 /permissionlist。'));
        const lines = [t('当前会话权限：{id}', { id: current.currentValue }), ''];
        if (list) {
          SNAPSHOTS.save(state, key, { sessionId, ids: current.options.map((item) => item.value) });
          for (const [index, item] of current.options.entries()) {
            const label = display(item.name);
            const detail = description(item);
            lines.push(`${index + 1}. ${item.value}${label && label !== item.value ? `（${label}）` : ''}${item.value === current.currentValue ? t(' ✓ 当前') : ''}${detail ? ` — ${detail}` : ''}`);
          }
          if (!current.options.length) lines.push(t('当前没有可用权限档位。'));
          lines.push('', t('切换：/permission <序号或完整ID>'));
        } else {
          lines.push(t('查看可用档位与序号：/permissionlist'));
        }
        lines.push(t(SCOPE));
        return result(lines.join('\n'));
      }

      let selected = requested;
      const numericId = /^id:(\d+)$/iu.exec(requested);
      if (numericId) selected = numericId[1];
      else if (/^\d+$/u.test(requested)) {
        const snapshot = SNAPSHOTS.load(state, key);
        if (!snapshot || snapshot.sessionId !== sessionId) return result(t(REFRESH));
        const index = Number(requested);
        if (!Number.isSafeInteger(index) || index < 1 || !snapshot.ids[index - 1]) {
          return result(t('权限档位序号无效，请重新执行 /permissionlist。'));
        }
        selected = snapshot.ids[index - 1];
      }
      if (selected === 'custom' || /^id:/iu.test(selected)) return result(t(USAGE));
      if (typeof session?.executeCommand !== 'function') return result(t('当前 Host 暂不支持从机器人查看或切换权限档位。'));
      signal.throwIfAborted();
      writing = true;
      const execution = await session.executeCommand(`/permission ${selected}`, { signal });
      if (execution === undefined) return result(t('当前 Host 未注册 /permission 命令，请确认权限预设组件已启用。'));
      const outcome = execution?.result;
      if (!outcome || !['success', 'error'].includes(outcome.kind)
        || (outcome.text !== undefined && typeof outcome.text !== 'string')) throw new TypeError('Invalid permission command result');
      if (outcome.kind === 'error') {
        if (outcome.text?.startsWith('unknown preset ')) {
          return result(t('该权限档位不存在或已不可用，请重新执行 /permissionlist。'));
        }
        return result([t('权限切换失败。'), display(outcome.text)].filter(Boolean).join('\n'));
      }
      return result([
        t('当前会话权限已切换为：{id}', { id: selected }), '', t(SCOPE),
        ...(selected === 'danger-full-access' ? [t('恢复工作区权限：/permission workspace-write（需 Host 支持该档位）')] : []),
      ].join('\n'));
    });
  } catch (error) {
    return result(errorMessage(error, writing));
  }
}
