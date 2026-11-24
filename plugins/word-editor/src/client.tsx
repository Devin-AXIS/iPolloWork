import { Component, lazy, Suspense, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';
import { assetPrefix, packageName } from './shared.ts';
import type { Draft, RendererContent } from './view-contract.ts';
import css from './view.css';

const documentSlot = 'sidebar.right.tab.document';
const id = packageName + '/docx';

interface DocumentProps {
  resourceAddress: string;
  useResource(address: string): { value?: { version?: string } };
  content: RendererContent | { kind: 'text' | 'bytes' };
}

interface Client {
  fileActions: FileActions;
  locale: { subscribe(listener: () => void): () => void; getSnapshot(): { active: string } };
  documentPreviews: { register(definition: {
    id: string; extensions: string[]; binaryExtensions: string[]; priority: 'extension';
    title(): string; loading: 'renderer'; wrap: boolean;
  }): () => void };
  slots: {
    inject(name: typeof documentSlot, install: () => () => void): () => void;
    register(entry: { name: typeof documentSlot; key: string }, render: (props: DocumentProps) => ReactNode): () => void;
  };
  effect(install: () => () => void, name: string): unknown;
}

export const inject = ['slots', 'locale', 'documentPreviews', 'fileActions'];

class EngineError extends Component<{ children: ReactNode; failed(): void; zh: boolean }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { this.props.failed(); }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <p role="alert" className="ipw-word-error">{this.props.zh
      ? 'Word 编辑器加载失败。请刷新应用或切换到系统预览。'
      : 'The Word editor could not load. Refresh the app or switch to the built-in preview.'}</p>;
  }
}

export function apply(ctx: Client) {
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return;
  const drafts = new Map<string, Draft>();
  const locale = () => ctx.locale.getSnapshot().active.startsWith('zh');
  const observe = ctx.locale.subscribe.bind(ctx.locale);
  let style: HTMLStyleElement | undefined;
  ctx.effect(() => {
    style = document.createElement('style');
    style.dataset.ipolloWordEditor = '';
    style.textContent = css;
    document.head.append(style);
    return () => { style?.remove(); style = undefined; drafts.clear(); };
  }, 'Word editor styles');
  const Editor = lazy(async () => {
    const url = new URL('api/' + assetPrefix + '/engine.mjs', document.baseURI);
    const engine = await import(url.href) as typeof import('./editor.tsx');
    if (style) style.textContent = engine.engineCss + '\n' + css;
    return { default: engine.Editor };
  });

  function DocumentBody({ content, resourceAddress, useResource }: DocumentProps) {
    const zh = useSyncExternalStore(observe, locale);
    const address = useMemo(() => parseFileAddress(resourceAddress), [resourceAddress]);
    const resourceVersion = useResource(resourceAddress).value?.version;
    if (content.kind !== 'renderer' || address?.scope !== 'session') return null;
    return <EngineError key={resourceAddress} failed={content.failed} zh={zh}><Suspense
      fallback={<p role="status" className="ipw-word-error">{zh ? '正在加载 Word 编辑器…' : 'Loading Word editor…'}</p>}>
      <Editor path={address.path} session={address.sessionId} native={content}
        resourceVersion={resourceVersion} zh={zh} drafts={drafts} fileActions={ctx.fileActions} />
    </Suspense></EngineError>;
  }
  ctx.effect(() => ctx.documentPreviews.register({
    id, extensions: ['docx'], binaryExtensions: ['docx'], priority: 'extension',
    title: () => locale() ? 'Word 编辑' : 'Word editor', loading: 'renderer', wrap: false,
  }), 'Word document view');
  ctx.effect(() => ctx.slots.inject(documentSlot, () => ctx.slots.register({
    name: documentSlot, key: id,
  }, DocumentBody)), 'Word editor body');
}
