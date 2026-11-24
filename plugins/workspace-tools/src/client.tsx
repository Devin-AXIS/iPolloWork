import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import { documentPattern, endpoint, feature, hasFeature, packageName, type Message } from './api.ts';
import { downloadMarkdown, errorText, label, request, type Language } from './browser.ts';
import { Editor } from './editor.tsx';
import { TemplateForm, WorkspaceTools, type TemplateDraft, type WorkspacePanel } from './workspace.tsx';
import css from './view.css';

const tabKind = endpoint;
const documentSlot = 'sidebar.right.tab.document.actions';
const paneSlot = 'sidebar.right.pane.tab';
const menuSlot = 'sidebar.workspaces.session.menu.item';
const overlaySlot = 'shell.overlay';
declare const __IPOLLO_WORKSPACE_KEEP_MOUNTED__: boolean;

interface DocumentProps { sessionId: string; absolutePath: string }
interface PaneProps {
  sessionId: string;
  useTabInfo(): { tab: { actions: { openResource(address: string): unknown } } };
}
interface SessionProps {
  sessionId: string;
  displayTitle: string;
  useMenuOpenState(): readonly [boolean, (value: boolean) => void];
}
interface SlotProps {
  [documentSlot]: DocumentProps;
  [paneSlot]: PaneProps;
  [menuSlot]: SessionProps;
  [overlaySlot]: object;
}
interface Client {
  fileActions: FileActions;
  locale: { subscribe(listener: () => void): () => void; getSnapshot(): { active: string } };
  sidebarRightTabs: { register(definition: { id: string; kind: string; title(): string; keepMounted: boolean;
    guide: readonly { id: string; order: number; title(): string; description(): string }[] }): () => void };
  uiWorkspace: { startSession(id: undefined, options: { prompt: string; whenDraftExists: 'keep' }): void };
  slots: {
    inject(name: keyof SlotProps, install: () => () => void): () => void;
    register<K extends keyof SlotProps>(entry: { name: K; id?: string; key?: string; order?: number },
      component: (props: SlotProps[K]) => ReactNode): () => void;
  };
  effect(install: () => () => void, description?: string): unknown;
}

export const inject = ['slots', 'locale', 'sidebarRightTabs', 'uiWorkspace', 'fileActions'];

type SessionAction = { kind: 'export' | 'template'; sessionId: string; title: string };
const workspacePanels = {
  'workspace-tools': ['all', '工作区工具', 'Workspace tools', '任务模板、参考资料和旧版导入', 'Task templates, references, and legacy import'],
  'task-templates': ['templates', '任务模板', 'Task templates', '保存和复用对话任务', 'Save and reuse conversation tasks'],
  'reference-preparation': ['references', '参考资料整理', 'Prepare references', '提取文档内容并在项目保存参考索引', 'Extract document content and save a project reference index'],
  'legacy-workspace-import': ['legacy', '旧版工作区导入', 'Import legacy workspace', '选择导入旧版命令和 Skill', 'Select legacy commands and skills to import'],
} satisfies Partial<Record<typeof feature, [WorkspacePanel, string, string, string, string]>>;

function panelForFeature() {
  if (feature in workspacePanels) return workspacePanels[feature as keyof typeof workspacePanels];
}

export function apply(ctx: Client) {
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return;
  const panel = panelForFeature();
  const templates = hasFeature('task-templates');
  const exportsConversations = hasFeature('conversation-export');
  const locale = () => ctx.locale.getSnapshot().active.startsWith('zh') ? 'zh' as const : 'en' as const;
  const translate = (zh: string, en: string) => label(locale(), zh, en);
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
    style.textContent = css;
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

  function WorkspaceTab({ sessionId, useTabInfo }: PaneProps) {
    const language = useLanguage();
    const { tab } = useTabInfo();
    return <WorkspaceTools key={sessionId} session={sessionId} language={language} panel={panel?.[0] ?? 'all'}
      start={prompt => ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'keep' })}
      openFile={path => { tab.actions.openResource(sessionFileAddress(sessionId, path)); }} />;
  }

  function SessionMenuEntry({ sessionId, displayTitle, useMenuOpenState }: SessionProps) {
    const language = useLanguage();
    const [, close] = useMenuOpenState();
    const choose = (kind: SessionAction['kind']) => {
      close(false);
      act({ kind, sessionId, title: displayTitle });
    };
    return <>
      {templates && <MenuItemButton separatorBefore onSelect={() => choose('template')}>{label(language, '保存为任务模板', 'Save as task template')}</MenuItemButton>}
      {exportsConversations && <MenuItemButton onSelect={() => choose('export')}>{label(language, '导出对话 Markdown', 'Export conversation as Markdown')}</MenuItemButton>}
    </>;
  }

  function SessionOverlay() {
    const action = useSyncExternalStore(subscribe, () => selected);
    const language = useLanguage();
    return action && <SessionDocument key={action.kind + ':' + action.sessionId} action={action}
      language={language} fileActions={ctx.fileActions} close={() => act(null)} />;
  }

  if (panel) {
    const [, zh, en, descriptionZh, descriptionEn] = panel;
    const title = () => translate(zh, en);
    ctx.effect(() => ctx.sidebarRightTabs.register({
      id: packageName, kind: tabKind, keepMounted: __IPOLLO_WORKSPACE_KEEP_MOUNTED__, title,
      guide: [{ id: feature, order: 15, title, description: () => translate(descriptionZh, descriptionEn) }],
    }), `${feature} tab`);
    ctx.effect(() => ctx.slots.inject(paneSlot, () => ctx.slots.register({
      name: paneSlot, key: packageName,
    }, WorkspaceTab)), `${feature} tab body`);
  }
  if (hasFeature('markdown-editor') || hasFeature('excel-editor')) {
    ctx.effect(() => ctx.slots.inject(documentSlot, () => ctx.slots.register({
      name: documentSlot, id: `ipollo.${feature}.edit`,
    }, DocumentAction)), `${feature} document action`);
  }
  if (templates || exportsConversations) {
    ctx.effect(() => ctx.slots.inject(menuSlot, () => ctx.slots.register({
      name: menuSlot, id: `ipollo.${feature}.session`, order: templates ? 550 : 551,
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
  const [draft, setDraft] = useState<TemplateDraft>();
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<Message[]>('messages', { query: { session: action.sessionId }, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setMessages(value);
      if (action.kind !== 'template' || !value.length) return;
      const first = value.find(message => message.role === 'user')?.text ?? '';
      const recent = value.filter(message => message.role === 'user').slice(-5).filter(message => message.text !== first);
      setDraft({ title: action.title.slice(0, 180), prompt: [first, ...recent.map(message => message.text)]
        .filter(Boolean).join('\n\n').slice(0, 50_000) });
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

  if (draft) return <TemplateForm draft={draft} language={language} close={close} saved={() => undefined} />;
  return <Modal open title={action.kind === 'export' ? t('导出对话 Markdown', 'Export conversation as Markdown') : t('保存为任务模板', 'Save as task template')}
    closeLabel={t('关闭', 'Close')} onClose={() => { if (!downloading) close(); }} footer={<>
      <Button onClick={close} disabled={downloading}>{t('关闭', 'Close')}</Button>
      {error && <Button onClick={() => { setError(''); retry(attempt + 1); }}>{t('重试', 'Retry')}</Button>}
      {action.kind === 'export' && !!messages?.length && <Button variant="primary" disabled={downloading} onClick={() => void download()}>
        {downloading ? t('正在下载…', 'Downloading…') : t('下载 Markdown', 'Download Markdown')}</Button>}
    </>}>
    {downloadError && <p role="alert" className="ipw-wt-error">{t('下载失败，请重试。', 'The download failed. Try again.')}</p>}
    {error ? <p role="alert" className="ipw-wt-error">{error}</p>
      : messages ? <p>{messages.length ? t(`将导出 ${messages.length} 条用户与助手消息。`, `Export ${messages.length} user and assistant messages.`)
        : t('此对话没有可导出的文字消息。', 'This conversation has no text messages to export.')}</p>
        : <p role="status">{t('正在读取对话…', 'Reading conversation…')}</p>}
  </Modal>;
}
