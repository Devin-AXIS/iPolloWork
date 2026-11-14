import { createHash } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateConversationDirectory } from './conversation-directory.mjs';

let lastSessionTimestamp = 0;

export function conversationDirectoryName(conversationKey, value, timestamp = Date.now(), identity = '') {
  const config = validateConversationDirectory(value);
  if (config.strategy === 'per-session') {
    timestamp = Math.max(Number(timestamp) || 0, lastSessionTimestamp + 1);
    lastSessionTimestamp = timestamp;
  }
  const digest = createHash('sha256').update(JSON.stringify([identity, conversationKey])).digest('hex').slice(0, 16);
  const suffix = `-${digest}${config.strategy === 'per-session' ? `-${timestamp}` : ''}`;
  const readable = conversationKey.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '-');
  const room = Math.max(0, 100 - config.prefix.length - suffix.length);
  return `${config.prefix}${readable.slice(0, room)}${suffix}`;
}

export async function prepareDirectoryPath(base, directory) {
  const root = await realpath(resolve(base));
  const target = resolve(directory);
  if (dirname(target) !== root) throw new Error('会话目录必须直接位于基工作区下。');
  try {
    const info = await stat(target);
    if (!info.isDirectory()) throw new Error('会话目录路径不是目录。');
    if ((await realpath(target)) !== target) throw new Error('会话目录不能是符号链接。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(target, { recursive: false, mode: 0o700 });
  }
  return target;
}

export async function ensureConversationDirectory({ baseWorkspace, conversationKey, config, sessionTimestamp }) {
  const normalized = validateConversationDirectory(config);
  const directory = resolve(baseWorkspace, conversationDirectoryName(conversationKey, normalized, sessionTimestamp));
  try {
    await prepareDirectoryPath(baseWorkspace, directory);
    return { workspace: directory };
  } catch (error) {
    console.warn('[dsh-im] conversation directory preparation failed:', error?.message ?? error);
    return { warning: '会话目录未生效：无法创建目录（权限或磁盘空间不足）；本次仍在原工作区运行。' };
  }
}
