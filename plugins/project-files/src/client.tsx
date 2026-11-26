import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { classifyFileType, fileSizeText, FileTypeIcon, ImageLightbox, Menu, type FileType, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives';
import { Modal } from '../../_shared/ui/modal.tsx';
import { fileMediaUrl, resolveWorkspacePath, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import { ArrowDownToLine, ChevronRight, ClipboardPaste, Copy as CopyIcon, ExternalLink, FileText, Folder,
  LayoutGrid, List, MoreHorizontal, Pencil, Plus, RefreshCw, Scissors, Search, Trash2, X } from 'lucide-react';
import { FormButton, SegmentedControl, TextInput } from '../../_shared/ui/controls.tsx';
import { endpoint, inputKey, pluginName, rasterMediaType, type Entry, type FileAction, type Input, type Snapshot } from './API.ts';
import { en, zh } from './copy.ts';
import common from '../../_shared/ui/controls.css';
import modalCss from '../../_shared/ui/modal.css';
import css from './view.css';

const tabKind = 'ipollo-project-files';
const outline = 1.6;
const dragType = 'application/x-ipollowork-project-file';

interface TabActions { openResource(address: string): unknown }
interface TabProps {
  sessionId: string;
  useTabInfo(): { tab: { actions: TabActions; visible: boolean } };
}
interface Client {
  locale: { subscribe(listener: () => void): () => void; getSnapshot(): { active: string } };
  sidebarRightTabs: { register(definition: { id: string; kind: string; title: () => string; keepMounted?: boolean; guide: readonly {
    id: string; order: number; title: () => string; description: () => string;
  }[] }): () => void };
  slots: {
    inject(name: 'sidebar.right.pane.tab', install: () => () => void): () => void;
    register(key: { name: 'sidebar.right.pane.tab'; key: string }, component: (props: TabProps) => ReactNode): () => void;
  };
  effect(install: () => () => void, description?: string): unknown;
}

export const inject = ['slots', 'locale', 'sidebarRightTabs'];

export function apply(ctx: Client) {
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return;
  const clipboard = createClipboard();
  const copy = () => ctx.locale.getSnapshot().active.startsWith('zh') ? zh : en;
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.ipolloProjectFiles = '';
    style.textContent = [common, modalCss, css].join('\n');
    document.head.append(style);
    return () => style.remove();
  }, 'project files styles');
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: pluginName, kind: tabKind, title: () => copy().files, keepMounted: true,
    guide: [{ id: 'project-files', order: 12, title: () => copy().files, description: () => copy().guide }],
  }), 'project files right sidebar type');
  function ProjectTab({ sessionId, useTabInfo }: TabProps) {
    const { tab } = useTabInfo();
    const t = useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), copy);
    return <ProjectFiles key={sessionId} sessionId={sessionId} actions={tab.actions} visible={tab.visible} t={t} clip={clipboard} />;
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: pluginName,
  }, ProjectTab)), 'project files right sidebar body');
}

function pathOf(session: string, params: Record<string, string> = {}) {
  return new URL(endpoint.slice(1) + '?' + new URLSearchParams({ session, ...params }), document.baseURI).href;
}
function inputHref(session: string, input: Input, thumbnail = false) {
  return pathOf(session, { source: input.sessionId, attachment: input.id, name: input.name, ...(thumbnail ? { thumbnail: '' } : {}) });
}
function match(names: readonly string[], value: string) {
  return !value || names.some(name => name.toLowerCase().includes(value));
}
function containingFolder(path: string) { return path.split('/').slice(0, -1).join('/'); }

type Copy = typeof en;
type View = 'icons' | 'list';
type Scope = 'current' | 'project';
type Source = 'input' | 'outputs';
type Location = { kind: 'library' | 'folders' | 'trash' };
type BrowserItem = { entry: Entry; title?: string } | { input: Input };
type Dialog = { kind: 'rename' | 'trash'; entry: Entry } | { kind: 'mkdir' };
type Clipboard = Extract<FileAction, { folder: string }> extends infer Operation
  ? Operation extends { kind: 'copy' | 'move' | 'copy-attachment' } ? Omit<Operation, 'folder'> : never
  : never;

const viewKey = 'ipollo.project-files.view';
function itemKind(item: BrowserItem): FileType {
  if ('entry' in item) return item.entry.kind === 'directory' ? 'folder' : classifyFileType(item.entry.name);
  return item.input.type === 'image' ? 'image' : classifyFileType(item.input.name);
}

function currentView(): View {
  try { return localStorage.getItem(viewKey) === 'list' ? 'list' : 'icons'; } catch { return 'icons'; }
}

function createClipboard() {
  const values = new Map<string, Clipboard>();
  const listeners = new Set<() => void>();
  return {
    get(project: string) { return values.get(project); },
    set(project: string, item: Clipboard | undefined) {
      if (item) values.set(project, item); else values.delete(project);
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

async function request<Value>(url: string, config?: RequestInit): Promise<Value> {
  const response = await fetch(url, config);
  const data = await response.json() as Value & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'operation-failed');
  return data;
}

function referenceEntry(input: Input): Entry | undefined {
  if (input.type !== 'reference' || input.path === undefined) return;
  return { path: input.path, name: input.name, bytes: input.bytes, kind: input.kind ?? 'file', modified: input.time };
}

function dragRecord(value: unknown): { project: string; item: Clipboard } | undefined {
  if (typeof value !== 'object' || value === null || !('project' in value) || typeof value.project !== 'string'
    || !('item' in value) || typeof value.item !== 'object' || value.item === null || !('kind' in value.item)) return;
  const { project, item } = value;
  if (item.kind === 'move' && 'path' in item && typeof item.path === 'string')
    return { project, item: { kind: 'move', path: item.path } };
  if (item.kind === 'copy-attachment' && 'source' in item && typeof item.source === 'string'
    && 'attachment' in item && typeof item.attachment === 'string' && 'name' in item && typeof item.name === 'string')
    return { project, item: { kind: 'copy-attachment', source: item.source, attachment: item.attachment, name: item.name } };
}

function ProjectFiles({ sessionId, actions, visible, t, clip }:
  { sessionId: string; actions: TabActions; visible: boolean; t: Copy; clip: ReturnType<typeof createClipboard> }) {
  const [location, navigate] = useState<Location>({ kind: 'library' });
  const [view, setView] = useState<View>(currentView);
  const [scope, setScope] = useState<Scope>('current');
  const [folder, setFolder] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [revision, refresh] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<BrowserItem>();
  const [imagePreview, setImagePreview] = useState<{ name: string; url: string }>();
  const closeImage = useCallback(() => setImagePreview(undefined), []);
  const [dialog, setDialog] = useState<Dialog>();
  const [dialogName, setDialogName] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragged, setDragged] = useState<Clipboard>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [folderMenu, setFolderMenu] = useState(false);
  const [folderMenuPoint, setFolderMenuPoint] = useState<MenuPoint>();
  const requestBusy = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const project = snapshot?.project.id ?? '';
  const clipboard = useSyncExternalStore(clip.subscribe, () => clip.get(project));

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const load = () => request<Snapshot>(pathOf(sessionId, { folder }), { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setSnapshot(value); setError(''); } })
      .catch((problem: Error) => {
        if (controller.signal.aborted) return;
        if (problem.message === 'missing' && folder) { setFolder(containingFolder(folder)); return; }
        setError(problem.message);
      });
    void load();
    const live = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 12000);
    return () => { controller.abort(); window.clearInterval(live); };
  }, [sessionId, folder, revision, visible]);

  function go(next: Location, path = '') {
    setSelected(undefined);
    setFolderMenu(false);
    setFolder(path);
    navigate(next);
    content.current?.scrollTo(0, 0);
  }
  function chooseView(next: View) {
    setView(next);
    try { localStorage.setItem(viewKey, next); } catch { /* The view can still change for this pane. */ }
  }
  async function update(action: FileAction) {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setBusy(true);
    setDialogError('');
    setNotice('');
    try {
      await request(pathOf(sessionId), { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
      if (action.kind === 'move' && clipboard?.kind === 'move' && clipboard.path === action.path)
        clip.set(project, undefined);
      setDialog(undefined);
      setSelected(undefined);
      setNotice(t.changed);
      refresh(value => value + 1);
    } catch (problem) {
      const code = problem instanceof Error ? problem.message : 'operation-failed';
      const label = t.errors[code as keyof Copy['errors']] ?? t.errors['operation-failed'];
      if (dialog) setDialogError(label);
      else setNotice(label);
    } finally { requestBusy.current = false; setBusy(false); }
  }
  function openEntry(entry: Entry) {
    if (entry.kind === 'directory') go({ kind: 'folders' }, entry.path);
    else actions.openResource(sessionFileAddress(sessionId, resolveWorkspacePath(snapshot?.project.root, entry.path)));
  }
  function showDialog(value: Dialog) {
    setDialogName(value.kind === 'rename' ? value.entry.name : '');
    setDialogError('');
    setDialog(value);
  }
  function addressOf(item: BrowserItem, kind: 'copy' | 'move'): Clipboard | undefined {
    if ('entry' in item) return { kind, path: item.entry.path };
    if (kind === 'copy') {
      const { id, sessionId, name } = item.input;
      return { kind: 'copy-attachment', source: sessionId, attachment: id, name };
    }
  }
  function stage(item: BrowserItem, kind: 'copy' | 'move') {
    const address = addressOf(item, kind);
    if (!address || !project) return;
    clip.set(project, address);
    setNotice(kind === 'copy' ? t.copied : t.cutReady);
  }
  function paste(target = folder) {
    if (clipboard) void update({ ...clipboard, folder: target });
  }
  function keys(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable], [role="dialog"], [role="menu"]')) return;
    const key = event.key.toLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && key === 'v' && clipboard && location.kind === 'folders') {
      event.preventDefault();
      paste(selected && 'entry' in selected && selected.entry.kind === 'directory' ? selected.entry.path : folder);
      return;
    }
    if (!selected) return;
    if (modifier && (key === 'c' || key === 'x')) {
      event.preventDefault();
      stage(selected, key === 'c' ? 'copy' : 'move');
    } else if ('entry' in selected) {
      if (key === 'f2') {
        event.preventDefault();
        showDialog({ kind: 'rename', entry: selected.entry });
      } else if (key === 'delete' || (modifier && key === 'backspace')) {
        event.preventDefault();
        showDialog({ kind: 'trash', entry: selected.entry });
      }
    }
  }
  function startDrag(event: DragEvent, item: BrowserItem) {
    if (!project) return;
    const address = addressOf(item, 'entry' in item ? 'move' : 'copy');
    if (!address) return;
    event.dataTransfer.effectAllowed = address.kind === 'copy-attachment' ? 'copy' : 'copyMove';
    event.dataTransfer.setData(dragType, JSON.stringify({ project, item: address }));
    setDragged(address);
  }
  function onDragOver(event: DragEvent, target: string) {
    if (!event.dataTransfer.types.includes(dragType)) return;
    if (dragged?.kind === 'move' && (target === dragged.path || target.startsWith(dragged.path + '/'))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.altKey || dragged?.kind === 'copy-attachment' ? 'copy' : 'move';
    setDropTarget(target);
  }
  function onDrop(event: DragEvent, target: string) {
    if (!event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault();
    event.stopPropagation();
    stopDrag();
    try {
      const source = dragRecord(JSON.parse(event.dataTransfer.getData(dragType)));
      if (!source || source.project !== project) return;
      const item = source.item.kind === 'move' && event.altKey ? { ...source.item, kind: 'copy' as const } : source.item;
      void update({ ...item, folder: target });
    } catch { /* A malformed external drop does not start a file operation. */ }
  }
  function stopDrag() { setDragged(undefined); setDropTarget(undefined); }

  const search = query.trim().toLowerCase();
  const library: Record<Source, BrowserItem[]> = { input: [], outputs: [] };
  for (const input of snapshot?.inputs ?? []) {
    if ((scope === 'current' && input.sessionId !== sessionId) || !match([input.name, input.path ?? ''], search)) continue;
    const entry = referenceEntry(input);
    library.input.push(entry ? { entry } : { input });
  }
  for (const entry of snapshot?.outputs ?? []) {
    if ((scope === 'current' && entry.sessionId !== sessionId) || !match([entry.name, entry.path, entry.title ?? ''], search)) continue;
    library.outputs.push({ entry, ...(entry.title ? { title: entry.title } : {}) });
  }
  const entries = snapshot?.folder === folder ? snapshot.entries.filter(item => match([item.name], search)) : [];
  const crumbParts = folder ? folder.split('/') : [];

  const file = (item: BrowserItem, direct = false) => {
    const entry = 'entry' in item ? item.entry : undefined;
    const stored = 'input' in item ? item.input : undefined;
    const name = entry?.name ?? stored!.name;
    const title = 'entry' in item ? item.title : undefined;
    const objectId = entry?.path ?? inputKey(stored!);
    const isSelected = selected !== undefined && ('entry' in selected ? selected.entry.path : inputKey(selected.input)) === objectId;
    const kind = itemKind(item);
    const website = Boolean(entry && kind === 'html');
    const download = stored ? inputHref(sessionId, stored) : undefined;
    const image = stored && (stored.type === 'image' || (stored.bytes <= 16 * 1024 * 1024 && rasterMediaType(stored.name)))
      ? inputHref(sessionId, stored, true)
      : entry && kind === 'image'
        ? fileMediaUrl(document.baseURI, resolveWorkspacePath(snapshot?.project.root, entry.path))
        : undefined;
    const downloadAttachment = () => {
      if (!download) return;
      const link = document.createElement('a');
      link.href = download;
      link.download = name;
      link.click();
    };
    const open = () => {
      if (entry) openEntry(entry);
      else if (image) setImagePreview({ name, url: image });
      else downloadAttachment();
    };
    const siteFolder = website && entry && /^index\.html?$/i.test(name)
      ? containingFolder(entry.path).split('/').at(-1) : undefined;
    const detail = title && title !== name ? name
      : kind === 'folder' ? undefined : siteFolder || fileSizeText(entry?.bytes ?? stored!.bytes);
    return <FileTile key={objectId} name={name} title={title} detail={detail} path={entry?.path}
      kind={kind} image={image} website={website}
      href={image ? undefined : download} direct={direct} t={t} selected={isSelected}
      cut={Boolean(entry && clipboard?.kind === 'move' && clipboard.path === entry.path)}
      drop={Boolean(entry?.kind === 'directory' && dropTarget === entry.path)}
      onOpen={open} onSelect={() => setSelected(item)}
      onDrag={event => startDrag(event, item)} onDragEnd={stopDrag}
      onDragOver={event => { if (entry?.kind === 'directory') onDragOver(event, entry.path); }}
      onDrop={event => { if (entry?.kind === 'directory') onDrop(event, entry.path); }}
      menu={[
        { id: 'open', label: website ? t.openSite : download && !image ? t.download : t.open,
          icon: menuIcon(download && !image ? ArrowDownToLine : ExternalLink), run: open },
        ...(download && image ? [{ id: 'download', label: t.download, icon: menuIcon(ArrowDownToLine), run: downloadAttachment }] : []),
        { id: 'copy', label: t.copy, icon: menuIcon(CopyIcon), shortcut: shortcut('C'), run: () => stage(item, 'copy') },
        ...(entry ? [
          { id: 'cut', label: t.cut, icon: menuIcon(Scissors), shortcut: shortcut('X'), run: () => stage(item, 'move') },
          ...(entry.kind === 'directory' ? [{ id: 'paste', label: t.paste, icon: menuIcon(ClipboardPaste), disabled: !clipboard, run: () => paste(entry.path) }] : []),
          ...(location.kind !== 'folders' ? [{ id: 'locate', label: t.inFolder, icon: menuIcon(Folder), run: () => go({ kind: 'folders' }, containingFolder(entry.path)) }] : []),
          { id: 'rename', label: t.rename, icon: menuIcon(Pencil), shortcut: { keys: ['F2'] }, run: () => showDialog({ kind: 'rename', entry }) },
          { id: 'trash', label: t.remove, icon: menuIcon(Trash2), danger: true, run: () => showDialog({ kind: 'trash', entry }) },
        ] : []),
      ]} />;
  };

  function group(source: Source) {
    const items = library[source];
    return <section aria-label={t[source]} className="ipf-group">
      <header className="ipf-section-title"><h3>{t[source]}</h3><small>{items.length}</small></header>
      {items.length > 0 ? <div className="ipf-items" data-view={view}>{items.map(item => file(item, true))}</div>
        : <p className="ipf-quiet">{search ? t.noMatches : source === 'input' ? t.noInputs : t.noOutputs}</p>}
    </section>;
  }

  return <section className="ipf" aria-label={t.files} onKeyDown={keys} aria-busy={!snapshot && !error}>
    <header className="ipf-header">
      <div><h2>{snapshot?.project.title ?? t.files}</h2></div>
      <div className="ipf-toolbar">
        <div className="ipf-view-switch" role="group" aria-label={t.view}>
          <FormButton className="ipf-icon-button" title={t.icons} aria-label={t.icons} aria-pressed={view === 'icons'}
            onClick={() => chooseView('icons')}><LayoutGrid size={15} strokeWidth={outline} /></FormButton>
          <FormButton className="ipf-icon-button" title={t.list} aria-label={t.list} aria-pressed={view === 'list'}
            onClick={() => chooseView('list')}><List size={15} strokeWidth={outline} /></FormButton>
        </div>
        <FormButton className="ipf-icon-button" title={t.reload} aria-label={t.reload} onClick={() => refresh(value => value + 1)}>
          <RefreshCw size={15} strokeWidth={outline} />
        </FormButton>
      </div>
    </header>
    <div className="ipf-contents" data-location={location.kind} ref={content}>
      {error && <p className="ipf-feedback" role="alert">{error === 'no-project' ? t.enterProject :
        t.errors[error as keyof Copy['errors']] ?? t.errors['operation-failed']}</p>}
      {!snapshot && !error && <p className="ipf-quiet">{t.loading}</p>}
      {snapshot && <>
        <div className="ipf-filter-row">
          {location.kind === 'library' && <SegmentedControl className="ipf-scope-selector" label={t.scope}
            value={scope} options={[{ id: 'current', label: t.current }, { id: 'project', label: t.project }]}
            change={next => { if (next !== scope) { setScope(next); go({ kind: 'library' }); } }} />}
          <div className="ipf-filter-tools">
            <div className="ipf-search">
              <TextInput type="search" value={query} onChange={event => setQuery(event.target.value)}
                placeholder={t.filter} aria-label={t.filter} icon={<Search size={15} strokeWidth={outline} />} />
              {query && <FormButton className="ipf-icon-button" aria-label={t.clear} title={t.clear} onClick={() => setQuery('')}>
                <X size={13} strokeWidth={outline} />
              </FormButton>}
            </div>
            {location.kind === 'library' && <FormButton className="ipf-root-action" size="sm"
              onClick={() => go({ kind: 'folders' })} onDragOver={event => onDragOver(event, '')}
              onDragLeave={() => setDropTarget(undefined)} onDrop={event => onDrop(event, '')}
              data-drop={dropTarget === '' || undefined}><Folder size={15} strokeWidth={outline} />{t.folder}</FormButton>}
          </div>
        </div>
        {location.kind !== 'library' && <nav className="ipf-crumbs" aria-label={t.files}>
          <button type="button" onClick={() => go({ kind: 'library' })}>{t.files}</button>
          <ChevronRight size={12} strokeWidth={outline} aria-hidden />
          {location.kind === 'trash' && <span aria-current="location">{t.trash}</span>}
          {location.kind === 'folders' && ['', ...crumbParts].map((name, index) => {
            const path = crumbParts.slice(0, index).join('/');
            return <span key={path}>{index > 0 && <ChevronRight size={12} strokeWidth={outline} aria-hidden />}
              <button type="button" data-drop={dropTarget === path || undefined} aria-current={path === folder ? 'location' : undefined}
                onClick={() => go({ kind: 'folders' }, path)} onDragOver={event => onDragOver(event, path)}
                onDragLeave={() => setDropTarget(undefined)} onDrop={event => onDrop(event, path)}>{name || t.folder}</button></span>;
          })}
        </nav>}
        {location.kind === 'library' && <div className="ipf-library">{group('input')}{group('outputs')}</div>}
        {location.kind === 'folders' && <section className="ipf-group" aria-label={t.folder}>
          <header className="ipf-section-title"><h3>{crumbParts.at(-1) || t.folder}</h3>
            <div className="ipf-directory-actions">
              {clipboard && <FormButton size="sm" onClick={() => paste()} disabled={busy}>{t.paste}</FormButton>}
              <Menu open={folderMenu} portal compact autoFocus align="end" onClose={() => setFolderMenu(false)}
                contextual={Boolean(folderMenuPoint)} anchorPoint={folderMenuPoint}
                items={[{ id: 'mkdir', label: t.newFolder, icon: menuIcon(Plus) },
                  { id: 'paste', label: t.paste, icon: menuIcon(ClipboardPaste), shortcut: shortcut('V'), disabled: !clipboard }]}
                onSelect={id => { setFolderMenu(false); if (id === 'mkdir') showDialog({ kind: 'mkdir' }); else paste(); }}
                anchor={<FormButton className="ipf-icon-button" aria-label={t.folderActions} title={t.folderActions} disabled={busy}
                  aria-haspopup="menu" aria-expanded={folderMenu}
                  onClick={() => { setFolderMenuPoint(undefined); setFolderMenu(open => !open); }}><Plus size={16} strokeWidth={outline} /></FormButton>} />
              <FormButton className="ipf-icon-button" aria-label={t.trash} title={t.trash}
                onClick={() => go({ kind: 'trash' })}><Trash2 size={15} strokeWidth={outline} /></FormButton>
            </div>
          </header>
          <div className="ipf-items ipf-folder-rows" data-view={view} data-drop={dropTarget === folder || undefined}
            onContextMenu={event => {
              if ((event.target as HTMLElement).closest('.ipf-tile')) return;
              event.preventDefault();
              event.stopPropagation();
              setFolderMenuPoint({ x: event.clientX, y: event.clientY });
              setFolderMenu(true);
            }}
            onDragOver={event => onDragOver(event, folder)}
            onDragLeave={event => {
              if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropTarget(undefined);
            }}
            onDrop={event => onDrop(event, folder)}>
            {entries.length ? entries.map(entry => file({ entry })) : <p className="ipf-quiet">
              {snapshot.folder !== folder ? t.loading : search ? t.folderEmpty : t.noFiles}</p>}
          </div>
        </section>}
        {location.kind === 'trash' && <section className="ipf-group" aria-label={t.trash}>
          <header className="ipf-section-title">
            <h3>{t.trash}</h3>
            <FormButton size="sm" onClick={() => go({ kind: 'folders' })}>{t.closeTrash}</FormButton>
          </header>
          <ul className="ipf-trash">
            {snapshot.trash.length ? snapshot.trash.map(entry => <li key={entry.id}>
              <FileGlyph kind={classifyFileType(entry.path)} /><span title={entry.path}>{entry.path}</span>
              <FormButton size="sm" variant="outline" disabled={busy}
                onClick={() => void update({ kind: 'restore', id: entry.id })}>{t.restore}</FormButton>
            </li>) : <li className="ipf-quiet">{t.noTrash}</li>}
          </ul>
        </section>}
        {snapshot.partial && <p className="ipf-quiet">{t.hidden}</p>}
      </>}
    </div>
    <div className="ipf-status" role="status" aria-live="polite">{notice}</div>
    {visible && imagePreview && <ImageLightbox src={imagePreview.url} alt={imagePreview.name}
      labels={{ dialog: imagePreview.name, close: t.close }} onClose={closeImage} />}
    {dialog && <Modal open title={dialog.kind === 'mkdir' ? t.newFolder : dialog.kind === 'rename' ? t.rename : t.remove}
      closeLabel={t.cancel} className="ipw-frosted" {...(dialog.kind === 'trash' ? { tone: 'warning' as const } : {})}
      onClose={() => { if (!busy) setDialog(undefined); }}>
      <form className="ipf-dialog-form" onSubmit={event => {
        event.preventDefault();
        if (dialog.kind === 'trash') void update({ kind: 'trash', path: dialog.entry.path });
        if (dialog.kind === 'rename') void update({ kind: 'rename', path: dialog.entry.path, name: dialogName });
        if (dialog.kind === 'mkdir') void update({ kind: 'mkdir', folder, name: dialogName });
      }}>
        {dialog.kind === 'trash' ? <p>{t.confirm} <strong>{dialog.entry.name}</strong></p> :
          <TextInput autoFocus value={dialogName} aria-label={t.name} onFocus={event => event.currentTarget.select()}
            onChange={event => { setDialogName(event.target.value); setDialogError(''); }} required />}
        {dialogError && <p role="alert">{dialogError}</p>}
        <footer><FormButton type="button" variant="outline" disabled={busy} onClick={() => setDialog(undefined)}>{t.cancel}</FormButton>
          <FormButton type="submit" variant="primary" disabled={busy || (dialog.kind !== 'trash' && !dialogName.trim())}>
            {dialog.kind === 'trash' ? t.remove : t.save}
          </FormButton>
        </footer>
      </form>
    </Modal>}
  </section>;
}

function FileGlyph({ kind, image }: { kind: FileType; image?: string | undefined }) {
  const [failedImage, setFailedImage] = useState<string>();
  return <span className="ipf-glyph" aria-hidden>
    {image && image !== failedImage
      ? <img className="ipf-thumbnail" src={image} alt="" loading="lazy" draggable={false} onError={() => setFailedImage(image)} />
      : <FileTypeIcon kind={kind} size={24} />}
  </span>;
}

function FileCaption({ name, detail }: { name: string; detail?: string | undefined }) {
  return <span className="ipf-main-text"><strong>{name}</strong>{detail && <small>{detail}</small>}</span>;
}

interface MenuPoint { x: number; y: number }
type FileMenu = MenuItem & { run(): void };
function menuIcon(Icon: typeof FileText) { return <Icon size={15} strokeWidth={outline} aria-hidden />; }
function shortcut(key: string) { return { keys: [navigator.platform.includes('Mac') ? '⌘' : 'Ctrl', key] }; }
function FileTile({ name, title, detail, path, kind, image, href, website, t, direct, selected, drop, cut, onOpen, onSelect,
  onDrag, onDragEnd, onDragOver, onDrop, menu }: {
    name: string; title: string | undefined; detail: string | undefined; path: string | undefined; kind: FileType;
    image: string | undefined; href: string | undefined;
    t: Copy; website: boolean; direct: boolean; selected: boolean; drop: boolean; cut: boolean;
    onOpen(): void; onSelect(): void; onDrag(event: DragEvent): void; onDragEnd(): void;
    onDragOver(event: DragEvent): void; onDrop(event: DragEvent): void; menu: readonly FileMenu[];
  }) {
  const [expanded, setExpanded] = useState(false);
  const [point, setPoint] = useState<MenuPoint>();
  const closeMenu = () => { setExpanded(false); setPoint(undefined); };
  const label = title ?? name;
  const tooltip = title && title !== name ? title + '\n' + (path ?? name) : path ?? name;
  const content = <><FileGlyph kind={kind} image={image} /><FileCaption name={label} detail={detail} /></>;
  return <div className="ipf-tile" data-selected={selected || undefined}
    data-cut={cut || undefined} data-drop={drop || undefined} draggable
    onDragStart={onDrag} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop}
    onContextMenu={event => {
      event.preventDefault();
      event.stopPropagation();
      onSelect();
      setPoint({ x: event.clientX, y: event.clientY });
      setExpanded(true);
    }}>
    {href ? <a className="ipf-main" aria-label={name} href={href} download={name}
      title={name} draggable={false} onFocus={onSelect}>{content}</a> :
      <button type="button" className="ipf-main" aria-label={website ? t.openSite + ' · ' + (title ?? path ?? name) : label}
        title={tooltip} onFocus={onSelect}
        onClick={() => { if (direct || window.matchMedia('(pointer: coarse)').matches) onOpen(); else onSelect(); }}
        onDoubleClick={() => { if (!direct) onOpen(); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onOpen(); } }}>
        {content}
      </button>}
    <Menu open={expanded} portal compact autoFocus onClose={closeMenu} align={point ? 'start' : 'end'}
      className={point ? 'ipf-file-menu-anchor ipf-context-anchor' : 'ipf-file-menu-anchor'}
      contextual={Boolean(point)} anchorPoint={point}
      items={menu.map(({ run: _run, ...item }) => item)}
      onSelect={id => { closeMenu(); menu.find(item => item.id === id)?.run(); }}
      anchor={<FormButton className="ipf-icon-button ipf-file-menu" aria-label={t.more + ' · ' + label}
        title={t.more} aria-haspopup="menu" aria-expanded={expanded}
        onClick={() => { onSelect(); setPoint(undefined); setExpanded(value => !value); }}><MoreHorizontal size={16} strokeWidth={outline} /></FormButton>} />
  </div>;
}
