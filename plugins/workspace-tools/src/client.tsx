import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives';
import { Modal } from '../../_shared/ui/modal.tsx';
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';
import { documentPattern, feature, hasFeature, type Message } from './api.ts';
import { downloadMarkdown, errorText, label, request, type Language } from './browser.ts';
import { Editor } from './editor.tsx';
import modalCss from '../../_shared/ui/modal.css';
import css from './view.css';

const documentSlot = 'sidebar.right.tab.document.actions';
const menuSlot = 'sidebar.workspaces.session.menu.item';
const overlaySlot = 'shell.overlay';

interface DocumentProps { sessionId: string; absolutePath: string }
interface SessionProps {
  sessionId: string;
  displayTitle: string;
  useMenuOpenState(): readonly [boolean, (value: boolean) => void];
}
interface SlotProps {
  [documentSlot]: DocumentProps;
  [menuSlot]: SessionProps;
  [overlaySlot]: object;
}
interface Client {
  fileActions: FileActions;
  locale: { subscribe(listener: () => void): () => void; getSnapshot(): { active: string } };
  slots: {
    inject(name: keyof SlotProps, install: () => () => void): () => void;
    register<K extends keyof SlotProps>(entry: { name: K; id?: string; key?: string; order?: number },
      component: (props: SlotProps[K]) => ReactNode): () => void;
  };
  effect(install: () => () => void, description?: string): unknown;
}

export const inject = ['slots', 'locale', 'fileActions'];

type SessionAction = { sessionId: string; title: string };

export function apply(ctx: Client) {
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return;
  const locale = () => ctx.locale.getSnapshot().active.startsWith('zh') ? 'zh' as const : 'en' as const;
  const subscribeLocale = ctx.locale.subscribe.bind(ctx.locale);
  const useLanguage = (): Language => useSyncExternalStore(subscribeLocale, locale);
  let selected: SessionAction | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const act = (action: SessionAction | null) => {
    selected = action;
    listeners.forEach(listener => listener());
  };

  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.ipolloWorkspaceTools = '';
    style.textContent = modalCss + '\n' + css;
    document.head.append(style);
    return () => style.remove();
  }, 'workspace tools styles');

  function DocumentAction({ sessionId, absolutePath }: DocumentProps) {
    const language = useLanguage();
    const [open, setOpen] = useState(false);
    if (!sessionId || !documentPattern.test(absolutePath)) return null;
    return <>
      <Button size="sm" variant="toolbar" onClick={() => setOpen(true)}>{label(language, '编辑', 'Edit')}</Button>
      {open && <Editor key={sessionId + ':' + absolutePath} session={sessionId} path={absolutePath}
        language={language} close={() => setOpen(false)} />}
    </>;
  }

  function SessionMenuEntry({ sessionId, displayTitle, useMenuOpenState }: SessionProps) {
    const language = useLanguage();
    const [, close] = useMenuOpenState();
    const choose = () => {
      close(false);
      act({ sessionId, title: displayTitle });
    };
    return <MenuItemButton onSelect={choose}>{label(language, '导出对话 Markdown', 'Export conversation as Markdown')}</MenuItemButton>;
  }

  function SessionOverlay() {
    const action = useSyncExternalStore(subscribe, () => selected);
    const language = useLanguage();
    return action && <SessionDocument key={action.sessionId} action={action}
      language={language} fileActions={ctx.fileActions} close={() => act(null)} />;
  }

  if (hasFeature('markdown-editor') || hasFeature('excel-editor')) {
    ctx.effect(() => ctx.slots.inject(documentSlot, () => ctx.slots.register({
      name: documentSlot, id: `ipollo.${feature}.edit`,
    }, DocumentAction)), `${feature} document action`);
  }
  if (hasFeature('conversation-export')) {
    ctx.effect(() => ctx.slots.inject(menuSlot, () => ctx.slots.register({
      name: menuSlot, id: `ipollo.${feature}.session`, order: 551,
    }, SessionMenuEntry)), `${feature} session menu`);
    ctx.effect(() => ctx.slots.inject(overlaySlot, () => ctx.slots.register({
      name: overlaySlot, id: `ipollo.${feature}.overlay`,
    }, SessionOverlay)), `${feature} session overlay`);
  }
}

function SessionDocument({ action, language, fileActions, close }: {
  action: SessionAction; language: Language; fileActions: FileActions; close(): void;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [messages, setMessages] = useState<Message[]>();
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<Message[]>('messages', { query: { session: action.sessionId }, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setMessages(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause, language)); });
    return () => controller.abort();
  }, [action, attempt, language]);
  async function download() {
    if (!messages?.length || downloading) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const result = await downloadMarkdown(fileActions, action.title, messages, language);
      if (result.status !== 'cancelled') close();
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  return <Modal open title={t('导出对话 Markdown', 'Export conversation as Markdown')}
    closeLabel={t('关闭', 'Close')} onClose={() => { if (!downloading) close(); }} footer={<>
      <Button onClick={close} disabled={downloading}>{t('关闭', 'Close')}</Button>
      {error && <Button onClick={() => { setError(''); retry(attempt + 1); }}>{t('重试', 'Retry')}</Button>}
      {!!messages?.length && <Button variant="primary" disabled={downloading} onClick={() => void download()}>
        {downloading ? t('正在下载…', 'Downloading…') : t('下载 Markdown', 'Download Markdown')}</Button>}
    </>}>
    {downloadError && <p role="alert" className="ipw-wt-error">{t('下载失败，请重试。', 'The download failed. Try again.')}</p>}
    {error ? <p role="alert" className="ipw-wt-error">{error}</p>
      : messages ? <p>{messages.length ? t(`将导出 ${messages.length} 条用户与助手消息。`, `Export ${messages.length} user and assistant messages.`)
        : t('此对话没有可导出的文字消息。', 'This conversation has no text messages to export.')}</p>
        : <p role="status">{t('正在读取对话…', 'Reading conversation…')}</p>}
  </Modal>;
}
