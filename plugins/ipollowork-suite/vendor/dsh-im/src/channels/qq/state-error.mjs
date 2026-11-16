import { t } from '../shared/i18n.mjs';

const MESSAGES = Object.freeze({
  'state-read-failed': '无法读取 QQ 本地状态，请检查数据目录及访问权限。',
  'state-backup-failed': 'QQ 本地状态已损坏，但无法备份，原文件已保留。',
  'state-write-failed': '无法保存 QQ 本地状态，请检查磁盘空间及目录写入权限。',
});

export function qqStateError(code, cause) {
  return Object.assign(new Error('QQ state operation failed', { cause }), { code });
}

export function publicQqStateError(error) {
  return Object.hasOwn(MESSAGES, error?.code ?? '')
    ? { code: error.code, message: t(MESSAGES[error.code]) }
    : null;
}
