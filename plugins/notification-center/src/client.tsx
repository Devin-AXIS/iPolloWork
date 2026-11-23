import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ConfigForm, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client';
import { Bell, Check, lineStroke, X } from '../../_shared/ui/icons.ts';
import type { NoticeItem, NotificationCenter } from './contract.ts';
import { feedLimit, notificationCenter, type FeedRow, type NotificationPreferences } from './model.ts';
import stylesheet from './style.css';
import { Button, SegmentedControl, Switch } from '../../_shared/ui/controls.tsx';
import controlsStyles from '../../_shared/ui/controls.css';

interface Snapshot<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
interface NativeSessions {
  uiSession: { sessionStatus: Snapshot<ReadonlyMap<string, {
    completionUnread: boolean; completionFailed: boolean;
  }>> & { mark(id: string, unread: boolean): Promise<void> } };
  sessions: { list: Snapshot<{ ids: readonly string[]; byId: Readonly<Record<string, { displayTitle: string; updatedAt: number; blank: boolean; origin?: 'subagent' }>> }> };
  workspaces: { list: Snapshot<{ archivedSessionIds: readonly string[] }> };
  uiWorkspace: { openSession(id: string): void };
}
interface Client {
  locale: Snapshot<{ active: string }>;
  slots: {
    inject(name: 'sidebar.footer.action' | 'settings.section' | 'settings.section.icon', install: () => () => void): () => void;
    register(options: { name: 'sidebar.footer.action'; id: string; order: number }, component: (props: { wide: boolean }) => ReactNode): () => void;
    register(options: { name: 'settings.section'; id: string; order: number; label(): string }, component: () => ReactNode): () => void;
    register(options: { name: 'settings.section.icon'; id: string }, component: (props: { size: number }) => ReactNode): () => void;
  };
  effect(install: () => () => void): void;
  provide(name: 'ipolloNotificationCenter', service: NotificationCenter): void;
  inject(names: ['configForms'], install: (scope: Client & { configForms: Pick<ConfigForms, 'get'> }) => void): void;
  inject(names: ['uiSession', 'uiSession.sessionStatus', 'sessions', 'workspaces', 'uiWorkspace'],
    install: (scope: Client & NativeSessions) => void): void;
}

const en = {
  title: 'Notifications', all: 'All', unread: 'Unread', close: 'Close notifications',
  empty: 'No notifications yet', caughtUp: 'No unread notifications', read: 'Mark as read',
  error: 'Could not update this notification. Try again.', conversations: 'Conversations',
  result: 'Unread conversation update', failed: 'The last run ended with an error',
  settings: 'Notifications', noSources: 'No notification sources are connected yet.',
  loadingSettings: 'Loading preferences…', unavailableSettings: 'Notification preferences are unavailable.',
  saveFailed: 'Could not save the preference. Try again.',
};
const zh: typeof en = {
  title: '通知中心', all: '全部', unread: '未读', close: '关闭通知中心',
  empty: '暂无通知', caughtUp: '没有未读通知', read: '标为已读',
  error: '暂时无法处理这条通知，请重试。', conversations: '对话',
  result: '有未读更新', failed: '上次运行出错',
  settings: '通知', noSources: '暂无已接入的通知来源。',
  loadingSettings: '正在读取通知设置…', unavailableSettings: '当前无法修改通知设置。',
  saveFailed: '通知设置未保存，请重试。',
};
const copy = (locale: string) => locale.toLowerCase().startsWith('zh') ? zh : en;
const pluginId = 'ipollo-notification-center';

function NotificationSettings({ center, locale, form }: {
  center: ReturnType<typeof notificationCenter>; locale: Client['locale']; form: ConfigForm<NotificationPreferences>;
}) {
  const { active } = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot());
  const sources = useSyncExternalStore(center.subscribe, center.getSources);
  const preferences = useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = copy(active);
  const canWrite = preferences.status === 'ready' && preferences.writable;

  async function change(id: string, enabled: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      setFailed(!await form.mutate([{ op: 'set', path: ['sourceEnabled', id], value: enabled }]));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return <section className="inc-settings">
    <h2>{t.settings}</h2>
    {preferences.status === 'loading' && <p role="status">{t.loadingSettings}</p>}
    {preferences.status !== 'loading' && !canWrite && <p role="status">{t.unavailableSettings}</p>}
    {sources.length > 0
      ? <ul>{sources.map(source => <li key={source.id}>
        <span>{source.label}</span>
        <Switch checked={source.enabled} onChange={enabled => void change(source.id, enabled)}
          label={source.label} disabled={busy || !canWrite} />
      </li>)}</ul>
      : preferences.status === 'ready' && <p>{t.noSources}</p>}
    {failed && <p role="alert">{t.saveFailed}</p>}
  </section>;
}

function Launcher({ center, locale, wide }: {
  center: ReturnType<typeof notificationCenter>; locale: Client['locale']; wide: boolean;
}) {
  const { active } = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot());
  const t = copy(active);
  const rows = useSyncExternalStore(center.subscribe, center.getSnapshot);
  const count = rows.filter(item => !item.read).length;
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const visible = unreadOnly ? rows.filter(row => !row.read) : rows;
  const clock = new Intl.DateTimeFormat(active, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function position() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !panel.current) return;
    const width = Math.min(400, window.innerWidth - 24);
    panel.current.style.setProperty('--inc-left', Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)) + 'px');
    panel.current.style.setProperty('--inc-bottom', Math.max(12, innerHeight - rect.top + 10) + 'px');
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  useEffect(() => { if (open) position(); }, [open, wide]);

  async function act(row: FeedRow, action: 'open' | 'markRead') {
    setBusy(row.key);
    setFailed(false);
    try {
      await center.act(row, action);
      if (action === 'open' && panel.current?.matches(':popover-open')) panel.current.hidePopover();
    } catch {
      setFailed(true);
    } finally {
      setBusy(undefined);
    }
  }
  return <>
    <Button size="sm" className="inc-trigger" ref={trigger} type="button" data-wide={wide}
      title={t.title} aria-label={count ? t.title + ' · ' + t.unread + ' ' + count : t.title}
      aria-controls={id} aria-expanded={open} aria-haspopup="dialog" popoverTarget={id}
      onClick={position}>
      <Bell size={19} strokeWidth={lineStroke} aria-hidden="true" />
      {count > 0 && <span className="inc-dot" aria-hidden="true" />}
    </Button>
    <div id={id} ref={panel} className="inc-panel ipw-frosted" popover="auto" role="dialog" aria-labelledby={id + '-title'}
      onToggle={event => {
        const expanded = event.newState === 'open';
        setOpen(expanded);
        setFailed(false);
        if (!expanded && (document.activeElement === document.body || panel.current?.contains(document.activeElement))) {
          trigger.current?.focus();
        }
      }}>
      <header className="inc-header">
        <h2 id={id + '-title'}>{t.title}</h2>
        <Button size="sm" type="button" className="inc-icon" aria-label={t.close}
          onClick={() => { panel.current?.hidePopover(); trigger.current?.focus(); }}><X strokeWidth={lineStroke} size={17} aria-hidden="true" /></Button>
      </header>
      <div className="inc-toolbar">
        <SegmentedControl label={t.title} value={unreadOnly ? 'unread' : 'all'} change={value => setUnreadOnly(value === 'unread')}
          className="inc-filters" options={[
            { id: 'all', label: t.all },
            { id: 'unread', label: t.unread, ...(count > 0 ? { count } : {}) },
          ]} />
        {failed && <p className="inc-action-error" role="alert">{t.error}</p>}
      </div>
      <div className="inc-scroll" tabIndex={0} role="region" aria-label={t.title}>
        {visible.length === 0 ? <div className="inc-empty">
          <Bell size={21} strokeWidth={1.4} aria-hidden="true" />
          <p>{unreadOnly ? t.caughtUp : t.empty}</p>
        </div> : <ul className="inc-list">{visible.map(row => {
          const description = <>
            <span className="inc-meta">
              <span>{row.sourceLabel}</span>
              <time dateTime={new Date(row.createdAt).toISOString()}>{clock.format(row.createdAt)}</time>
            </span>
            <strong className="inc-headline">{row.title}</strong>
            {row.summary && <span className="inc-summary">{row.summary}</span>}
          </>;
          return <li className="inc-row" key={row.key} data-unread={!row.read} data-tone={row.tone ?? 'info'}>
            <span className="inc-state" aria-hidden="true" />
            {row.canOpen ? <Button size="sm" className="inc-content" type="button" disabled={busy !== undefined}
              onClick={() => void act(row, 'open')}>{description}</Button> : <div className="inc-content">{description}</div>}
            {!row.read && <Button size="sm" type="button" className="inc-icon inc-mark" disabled={busy !== undefined}
              aria-label={t.read + ' · ' + row.title} title={t.read} onClick={() => void act(row, 'markRead')}>
              <Check strokeWidth={lineStroke} size={15} aria-hidden="true" />
            </Button>}
          </li>;
        })}</ul>}
      </div>
    </div>
  </>;
}

export const inject = ['slots', 'locale'];

export function apply(ctx: Client): void {
  const center = notificationCenter();
  ctx.provide('ipolloNotificationCenter', center.service);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = stylesheet + '\n' + controlsStyles;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: pluginId, order: 50,
  }, ({ wide }) => <Launcher center={center} locale={ctx.locale} wide={wide} />));

  ctx.inject(['configForms'], scope => {
    const form = scope.configForms.get<NotificationPreferences>(pluginId);
    scope.effect(() => {
      const sync = () => {
        const { status, value } = form.getSnapshot();
        center.setPreferences(value?.sourceEnabled ?? (status === 'loading' ? null : {}));
      };
      const unsubscribe = form.subscribe(sync);
      sync();
      return () => { unsubscribe(); center.setPreferences({}); };
    });
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section', id: pluginId, order: 5,
      label: () => copy(ctx.locale.getSnapshot().active).settings,
    }, () => <NotificationSettings center={center} locale={ctx.locale} form={form} />));
    scope.slots.inject('settings.section.icon', () => scope.slots.register({
      name: 'settings.section.icon', id: pluginId,
    }, ({ size }) => <Bell size={size} strokeWidth={lineStroke} aria-hidden="true" />));
  });

  ctx.inject(['uiSession', 'uiSession.sessionStatus', 'sessions', 'workspaces', 'uiWorkspace'], scope => scope.effect(() => {
    const status = scope.uiSession.sessionStatus;
    const catalog = scope.sessions.list;
    const workspaces = scope.workspaces.list;
    const language = () => copy(ctx.locale.getSnapshot().active);
    return center.service.registerSource('dsh.conversations', {
      label: () => language().conversations,
      getSnapshot() {
        const summaries = catalog.getSnapshot();
        const reading = status.getSnapshot();
        const archived = new Set(workspaces.getSnapshot().archivedSessionIds);
        const t = language();
        const items: NoticeItem[] = [];
        for (const id of summaries.ids) {
          const session = summaries.byId[id];
          const state = reading.get(id);
          if (!session || session.blank || session.origin === 'subagent' || archived.has(id) || !state?.completionUnread) continue;
          items.push({
            id, title: session.displayTitle, summary: state.completionFailed ? t.failed : t.result,
            createdAt: session.updatedAt, tone: state.completionFailed ? 'error' : 'info', read: false,
          });
        }
        return items.sort((left, right) => right.createdAt - left.createdAt).slice(0, feedLimit);
      },
      subscribe(listener) {
        const dispose = [catalog, status, workspaces, ctx.locale].map(source => source.subscribe(listener));
        return () => dispose.forEach(stop => stop());
      },
      markRead: id => status.mark(id, false),
      open: id => scope.uiWorkspace.openSession(id),
    });
  }));
}
