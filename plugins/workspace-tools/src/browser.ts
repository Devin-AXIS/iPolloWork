import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';
import { downloadBlob } from '../../_shared/download-blob.ts';
import { endpoint, type Message } from './api.ts';

export type Language = 'zh' | 'en';
export const label = (language: Language, zh: string, en: string) => language === 'zh' ? zh : en;

export async function request<T>(action: string, options: {
  query?: Record<string, string>; data?: unknown; signal?: AbortSignal; blob?: boolean;
} = {}): Promise<T> {
  const url = new URL('api/' + endpoint + (options.data === undefined ? '' : '/write'), document.baseURI);
  url.search = new URLSearchParams({ action, ...options.query }).toString();
  const response = await fetch(url, {
    credentials: 'same-origin', cache: 'no-store', ...(options.signal ? { signal: options.signal } : {}),
    ...(options.data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.data),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw Error(body.error ?? 'failed');
  }
  return (options.blob ? await response.blob() : await response.json()) as T;
}

export function errorText(error: unknown, language: Language) {
  const code = error instanceof Error ? error.message : 'failed';
  const labels: Record<string, [string, string]> = {
    conflict: ['文件已被其他操作修改，草稿保留在编辑器中。请复制草稿或重新打开文件后合并。', 'The file changed elsewhere. Your draft is still here. Copy it or reopen the file to merge changes.'],
    'invalid-cell': ['有单元格的内容与所选类型不匹配。', 'A cell value does not match its selected type.'],
    'protected-cell': ['选区包含公式、合并区域或受保护单元格。', 'The selection contains a formula, merged range, or protected cell.'],
    'unsupported-file': ['无法编辑此文件格式或内容。', 'This file format or content cannot be edited.'],
    'outside-project': ['文件不在当前工作区内。', 'This file is outside the current workspace.'],
    'unsupported-project': ['请在本地工作区的对话中使用此功能。', 'Use this feature from a conversation in a local workspace.'],
    'read-only': ['当前会话是只读的。', 'This conversation is read-only.'],
    'too-large': ['所选数据超出编辑或导入大小上限。', 'The selected data exceeds the editor or import limit.'],
    'file-busy': ['文件正被其他应用使用。关闭文件后重试。', 'Another app is using this file. Close it there and try again.'],
    'invalid-request': ['请检查文件格式和必填内容。', 'Check the file format and required fields.'],
    missing: ['找不到所选文件或会话。', 'The selected file or conversation could not be found.'],
    unauthorized: ['当前账号没有执行此操作的权限。', 'Your account is not permitted to do this.'],
    failed: ['操作失败。请重试。', 'The operation failed. Try again.'],
  };
  const [zh, en] = labels[code] ?? labels.failed!;
  return label(language, zh, en);
}

export function downloadMarkdown(fileActions: FileActions, title: string, messages: Message[], language: Language) {
  const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).replace(/[. ]+$/, '');
  const filename = (safe || 'conversation') + '.md';
  const text = '# ' + title.replace(/[\r\n]+/g, ' ') + '\n\n' + messages.map(message => {
    const role = message.role === 'user'
      ? label(language, '用户', 'User') : label(language, '助手', 'Assistant');
    return '## ' + role + '\n\n' + message.text;
  }).join('\n\n') + '\n';
  return downloadBlob(fileActions, new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename);
}
