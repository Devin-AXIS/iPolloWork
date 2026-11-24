import { useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';
import { feature, packageName } from './api.ts';
import { binarySpreadsheetExtensions, markdownExtensions, spreadsheetExtensions } from './file-contract.ts';
import { FileEditor } from './file-editor.tsx';
import css from './file-view.css';

const slot = 'sidebar.right.tab.document';
const implementation = `${packageName}/edit`;
type Content = ComponentProps<typeof FileEditor>['native'];
interface BodyProps {
  resourceAddress: string;
  content: Content | { kind: 'text' | 'bytes' };
  useResource(address: string): { value?: { absolutePath?: string; version?: string } };
}
interface Client {
  fileActions?: FileActions;
  locale: { subscribe(listener: () => void): () => void; getSnapshot(): { active: string } };
  documentPreviews: { register(options: { id: string; extensions: string[]; binaryExtensions?: string[];
    priority: 'extension'; title(): string; loading: 'renderer'; wrap: boolean }): () => void };
  slots: {
    inject(name: typeof slot, register: () => () => void): () => void;
    register(entry: { name: typeof slot; key: string }, body: (props: BodyProps) => ReactNode): () => void;
  };
  effect(mount: () => () => void, name: string): unknown;
}

export const inject = ['slots', 'locale', 'documentPreviews', ...(feature === 'excel-editor' ? ['fileActions'] : [])];

export function apply(ctx: Client) {
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return;
  const markdown = feature === 'markdown-editor';
  const drafts: ComponentProps<typeof FileEditor>['drafts'] = new Map();
  const language = () => ctx.locale.getSnapshot().active.startsWith('zh') ? 'zh' as const : 'en' as const;
  const subscribe = ctx.locale.subscribe.bind(ctx.locale);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.ipolloFileEditor = feature;
    style.textContent = css;
    document.head.append(style);
    return () => { style.remove(); drafts.clear(); };
  }, `${feature}: styles`);
  ctx.effect(() => ctx.documentPreviews.register({
    id: implementation, extensions: markdown ? markdownExtensions : spreadsheetExtensions,
    ...!markdown && { binaryExtensions: binarySpreadsheetExtensions }, priority: 'extension', wrap: false, loading: 'renderer',
    title: () => markdown ? language() === 'zh' ? 'Markdown 编辑' : 'Markdown Editor'
      : language() === 'zh' ? 'Excel 编辑' : 'Excel Editor',
  }), `${feature}: viewer`);
  function Body({ resourceAddress, useResource, content }: BodyProps) {
    const locale = useSyncExternalStore(subscribe, language);
    const address = parseFileAddress(resourceAddress);
    const resource = useResource(resourceAddress).value;
    if (content.kind !== 'renderer') return null;
    if (address?.scope !== 'session') return <p className="ipw-file-notice" role="status">{locale === 'zh'
      ? '在本地工作区打开文件后即可编辑。其他文件可用工具栏切换查看方式。'
      : 'Open a file in a local workspace to edit it. Use the toolbar to view other files.'}</p>;
    const path = resource?.absolutePath ?? address.path;
    return <FileEditor key={path} session={address.sessionId} path={path}
      observedVersion={resource?.version} language={locale} native={content} drafts={drafts} fileActions={ctx.fileActions} />;
  }
  ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, key: implementation }, Body)), `${feature}: editor`);
}
