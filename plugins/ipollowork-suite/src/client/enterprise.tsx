import { useEffect, useState, type FormEvent } from 'react'
import { Button, IconChevronDownOutlineRegular, IconRefreshOutlineRegular, IconShareOutlineRegular, IconUsersOutlineRegular, IconWorkspaceTreeOutlineRegular, Menu, Modal, SegmentedTabs, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseCatalog, EnterpriseDetail, ProjectWork, ProjectGrant } from '../shared/enterprise.ts'
import type { ClientContext } from './native.ts'
import type { AccountController } from './account.tsx'
import { EnterpriseController, type EnterpriseState, type EnterpriseTab } from './enterprise-controller.ts'
import { enterpriseCopy, enterpriseLabels, format, type EnterpriseLabels } from './enterprise-locale.ts'
import { language } from './locale.ts'
import { createOwnedProject } from './project-creation-actions.ts'
import { EnterpriseDirectoryFlow, ProjectCreationDialog, type ProjectCreationProps } from './project-creation.tsx'
import { ActivityTab, ProjectView, ProjectsTab, type CollaborationActions, type ViewProps } from './collaboration.tsx'
import { InviteDialog, MemberDialog, MembersTab, NoEnterprise } from './enterprise-members.tsx'
import { ShareDialog } from './enterprise-share.tsx'
import { ConfirmDialog, EmptyState, Field, FormError, ListSkeleton, Notice, ToastHost, roleName, useRecord, useTask } from './enterprise-ui.tsx'
import css from './suite.module.css'

const PANEL = 'ipollowork-enterprise'

export interface Props extends Pick<ProjectCreationProps, 'createProject' | 'listDirectory' | 'createDirectory' | 'pickDirectory' | 'refreshEnterprises'> {
  useEnterpriseState<T>(selector: (state: EnterpriseState) => T): T
  useEnterpriseLabels<T>(selector: (labels: EnterpriseLabels) => T): T
  useLocale<T>(selector: (value: string) => T): T
  controller: EnterpriseController
  actions: CollaborationActions
  openAccountSettings(): boolean
  viewShare(id: string): void
}

/** Keep the share entry visible while account loading and sign-in are handled by its action. */
function ProjectShareAction({sessionId,useSessions,useEnterpriseLabels,openShare}:{sessionId:string;useSessions<T>(selector:(state:{byId:Record<string,{displayTitle?:string}>})=>T):T;openShare(sessionId:string,title:string):void}&Pick<Props,'useEnterpriseLabels'>){
  const t=useEnterpriseLabels(value=>value)
  const title=useSessions(state=>state.byId[sessionId]?.displayTitle??'')
  return <Button variant="ghost" size="sm" onClick={()=>openShare(sessionId,title)}>{t.share}<IconShareOutlineRegular size={12}/></Button>
}

function EnterpriseSwitcher({ catalog, enterpriseId, t, controller }: { catalog: EnterpriseCatalog; enterpriseId: string; t: EnterpriseLabels; controller: EnterpriseController }) {
  const [open, setOpen] = useState(false)
  const current = catalog.enterprises.find(e => e.id === enterpriseId)
  return <Menu open={open} portal onClose={() => setOpen(false)} selectedId={enterpriseId}
    anchor={<button type="button" className={css.switcher} aria-label={t.switchEnterprise} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className={css.switcherMark} aria-hidden>{current?.name.slice(0, 1)}</span>
      <span className={css.switcherText}><strong>{current?.name}</strong><small>{current && `${roleName(current.role, t)} · ${format(t.memberCount, { count: current.memberCount })}`}</small></span>
      <IconChevronDownOutlineRegular size={14}/>
    </button>}
    items={[
      { type: 'label', id: 'label', text: t.switchEnterprise },
      ...catalog.enterprises.map(e => ({ id: e.id, label: e.name })),
      { type: 'separator', id: 'separator' },
      { id: ':join', label: t.join },
      { id: ':create', label: t.create },
    ]}
    onSelect={id => {
      setOpen(false)
      if (id === ':join') controller.open({ kind: 'join' })
      else if (id === ':create') controller.open({ kind: 'create' })
      else controller.selectEnterprise(id)
    }}/>
}

function EnterprisePanel(props: Props) {
  const t = props.useEnterpriseLabels(v => v), state = props.useEnterpriseState(v => v), language = props.useLocale(v => v)
  const { controller } = props
  useEffect(() => { if (state.signedIn && !state.catalog) void controller.load() }, [state.signedIn])
  if (!state.signedIn) return <section className={css.page + ' ' + css.enterprisePage} data-ipw-enterprise>
    <div className={css.heading}><div><h1>{t.title}</h1><p>{t.intro}</p></div></div>
    <EmptyState title={t.signIn} hint={t.signInRequired}><Button variant="primary" onClick={() => props.openAccountSettings()}>{t.signInAction}</Button></EmptyState>
  </section>
  const catalog = state.catalog
  if (!catalog) return <section className={css.page + ' ' + css.enterprisePage} data-ipw-enterprise>
    <div className={css.heading}><div><h1>{t.title}</h1><p>{t.intro}</p></div></div>
    {state.error ? <Notice error={state.error} t={t} retry={() => void controller.load()}/> : <ListSkeleton rows={4}/>}
  </section>
  const view: ViewProps = { t, language, call: controller.call, controller, catalog, revision: state.revision, actions: props.actions }
  const top = state.views.at(-1)
  const enterpriseId = state.enterpriseId
  const tabs = [
    { value: 'activity' as const, label: t.activity, id: 'ipw-enterprise-tab-activity', panelId: 'ipw-enterprise-panel-activity' },
    { value: 'projects' as const, label: t.projectsTab, id: 'ipw-enterprise-tab-projects', panelId: 'ipw-enterprise-panel-projects' },
    { value: 'members' as const, label: t.membersTab, id: 'ipw-enterprise-tab-members', panelId: 'ipw-enterprise-panel-members' },
  ] as const
  const active = tabs.find(tab => tab.value === state.tab) ?? tabs[0]
  return <section className={css.page + ' ' + css.enterprisePage} data-ipw-enterprise>
    {top ? <div key={JSON.stringify(top)} className={css.enterpriseView}>
      {<ProjectView id={top.id} view={view}/>}
    </div> : <>
      <div className={css.heading}>
        <div><h1>{t.title}</h1><p>{t.intro}</p></div>
        <div className={css.enterpriseActions}>
          {enterpriseId && <EnterpriseSwitcher catalog={catalog} enterpriseId={enterpriseId} t={t} controller={controller}/>}
          <Button variant="ghost" size="sm" aria-label={t.refresh} title={t.refresh} disabled={state.loading} icon={<IconRefreshOutlineRegular size={16}/>} onClick={() => void controller.load()}/>
        </div>
      </div>
      <Notice error={state.error} t={t} retry={() => void controller.load()}/>
      {!enterpriseId ? <NoEnterprise t={t} controller={controller}/> : <>
        <SegmentedTabs className={css.enterpriseTabs} label={t.title} items={tabs} value={active.value} onChange={(tab: EnterpriseTab) => controller.selectTab(tab)}/>
        <div id={active.panelId} role="tabpanel" aria-labelledby={active.id} className={css.enterpriseView}>
          {active.value === 'activity' ? <ActivityTab enterpriseId={enterpriseId} view={view}/>
            : active.value === 'projects' ? <ProjectsTab enterpriseId={enterpriseId} view={view}/>
            : <MembersTab enterpriseId={enterpriseId} userId={catalog.userId} revision={state.revision} t={t} call={controller.call} controller={controller}/>}
        </div>
      </>}
    </>}
  </section>
}

function SimpleDialog({ kind, t, controller }: { kind: 'create' | 'join'; t: EnterpriseLabels; controller: EnterpriseController }) {
  const task = useTask(t), [input, setInput] = useState('')
  const close = () => { if (!task.busy) controller.open(null) }
  const submit = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    if (kind === 'create') {
      const result = await controller.call<{ id: string }>('/organizations', { name: input })
      controller.selectEnterprise(result.id); controller.selectTab('members'); controller.notify(t.enterpriseCreated)
    } else {
      const result = await controller.call<{ enterpriseId?: string; enterprise_id?: string }>('/join', { invitation: input })
      const joined = result.enterpriseId ?? result.enterprise_id
      if (joined) controller.selectEnterprise(joined)
      controller.selectTab('activity'); controller.notify(t.joined)
    }
    controller.open(null); await controller.load()
  }) }
  return <Modal open title={kind === 'create' ? t.create : t.join} description={kind === 'create' ? t.emptyHint : t.joinHint} closeLabel={t.close} className={css.enterpriseModal!} onClose={close}>
    <form className={css.enterpriseForm} onSubmit={submit}>
      <Field label={kind === 'create' ? t.name : t.invitation}><input autoFocus required maxLength={kind === 'create' ? 120 : 2048} value={input} onChange={e => setInput(e.target.value)} disabled={task.busy}/></Field>
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy || !input.trim()}>{kind === 'create' ? t.create : t.joinAction}</Button></div>
    </form>
  </Modal>
}

function AssignDialog({ projectId, t, controller, catalog }: { projectId: string; t: EnterpriseLabels; controller: EnterpriseController; catalog: EnterpriseCatalog }) {
  const project = catalog.projects.find(p => p.id === projectId)
  const task = useTask(t), [selected, setSelected] = useState(project?.enterpriseId ?? '')
  const close = () => { if (!task.busy) controller.open(null) }
  if (!project) return null
  return <Modal open title={t.ownership} description={project.path} closeLabel={t.close} className={css.enterpriseModal!} onClose={close}>
    <form className={css.enterpriseForm} onSubmit={e => { e.preventDefault(); void task.run(async () => {
      await controller.call('/assign', { projectId: project.id, enterpriseId: selected || null }); controller.notify(t.ownershipSaved); controller.open(null); await controller.load()
    }) }}>
      <Field label={t.choose} hint={t.ownershipHint}><select value={selected} onChange={e => setSelected(e.target.value)} disabled={task.busy}><option value="">{t.personal}</option>{catalog.enterprises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy || selected === (project.enterpriseId ?? '')}>{t.save}</Button></div>
    </form>
  </Modal>
}

/** Member dialogs read the enterprise record they edit, so they work from any page state. */
function WithDetail({ enterpriseId, t, controller, children }: { enterpriseId: string; t: EnterpriseLabels; controller: EnterpriseController; children(detail: EnterpriseDetail): JSX.Element | null }) {
  const detail = useRecord<EnterpriseDetail>('/organizations/' + enterpriseId, controller.call, 0)
  if (detail.data) return children(detail.data)
  return detail.error ? <Modal open title={t.manage} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => controller.open(null)}><Notice error={detail.error} t={t} retry={detail.reload}/></Modal> : null
}

function DialogHost(props: Props) {
  const state = props.useEnterpriseState(v => v), t = props.useEnterpriseLabels(v => v), language = props.useLocale(v => v)
  const { controller } = props, dialog = state.dialog, close = () => controller.open(null)
  if (!dialog || !state.signedIn) return null
  switch (dialog.kind) {
    case 'create': case 'join': return <SimpleDialog key={dialog.kind} kind={dialog.kind} t={t} controller={controller}/>
    case 'createProject': return <ProjectCreationDialog {...props} open onCancel={close} onCreated={project => { close(); props.actions.openProject(project.workspaceId) }}/>
    case 'confirm': return <ConfirmDialog title={dialog.title} description={dialog.description} confirmLabel={dialog.confirmLabel} t={t} run={dialog.run} close={close}/>
    case 'invite': return <WithDetail enterpriseId={dialog.enterpriseId} t={t} controller={controller}>{detail => <InviteDialog dialog={dialog} t={t} call={controller.call} controller={controller} departments={detail.departments}/>}</WithDetail>
    case 'member': return <WithDetail enterpriseId={dialog.enterpriseId} t={t} controller={controller}>{detail => <MemberDialog enterpriseId={dialog.enterpriseId} userId={dialog.userId} t={t} call={controller.call} controller={controller} detail={detail}/>}</WithDetail>
  }
  const catalog = state.catalog
  if (!catalog) return dialog.kind==='share'?<Modal open title={t.share} closeLabel={t.close} className={css.enterpriseModal!} onClose={close}>
    {state.error?<Notice error={state.error} t={t} retry={controller.load}/>:<ListSkeleton rows={2}/>}
  </Modal>:null
  switch (dialog.kind) {
    case 'assign': return <AssignDialog key={dialog.projectId} projectId={dialog.projectId} t={t} controller={controller} catalog={catalog}/>
    case 'share': return catalog.enterprises.length ? <ShareDialog key={dialog.sessionId} sessionId={dialog.sessionId} title={dialog.title} t={t} call={controller.call} controller={controller} catalog={catalog} viewShare={props.viewShare} language={language}/>
      : <Modal open title={t.share} closeLabel={t.close} className={css.enterpriseModal!} onClose={close}><NoEnterprise t={t} controller={controller}/></Modal>
  }
}

/** Sidebar row mark for native conversations that continue team work. */
function CollaborationMark({ sessionId, useEnterpriseState, useEnterpriseLabels }: { sessionId: string } & Pick<Props, 'useEnterpriseState' | 'useEnterpriseLabels'>) {
  const linked = useEnterpriseState(s => !!s.catalog?.work.some(w => w.nativeSessionId === sessionId)), t = useEnterpriseLabels(v => v)
  return linked ? <span className={css.rowMark} role="img" aria-label={t.collaborationSession} title={t.collaborationSession}><IconUsersOutlineRegular size={13}/></span> : null
}

/** Register a reversible enterprise page plus actions on the existing project and conversation menus. */
export function mountEnterprise(ctx: ClientContext, account: AccountController): void {
  const controller = new EnterpriseController(), labels = enterpriseLabels(ctx)
  const locale = { getSnapshot: () => language(ctx), subscribe: (listener: () => void) => ctx.locale.subscribe(listener) }
  ctx.effect(() => () => controller.dispose(), 'ipollowork-suite: enterprise')
  ctx.effect(() => { window.addEventListener('focus', controller.refreshIfStale); return () => window.removeEventListener('focus', controller.refreshIfStale) }, 'ipollowork-suite: refresh collaboration')
  const pendingOwnership = new Set<string>()
  const actions: CollaborationActions = { openProject: id => { void ctx.uiWorkspace.openWorkspace(id) } }
  const viewShare = (id: string) => { ctx.layout.selectPanel(PANEL); controller.show({ kind: 'project', id }) }
  const openShare=(sessionId:string,title:string)=>{
    const state=controller.getSnapshot()
    if(!state.signedIn){if(!account.openAccountSettings())ctx.layout.selectPanel(PANEL);return}
    controller.open({kind:'share',sessionId,title})
    if(!state.catalog)void controller.load()
  }
  const creation = {
    refreshEnterprises: controller.load,
    listDirectory: (path?: string, signal?: AbortSignal) => ctx.uiWorkspace.listDirectory(path, signal),
    createDirectory: (path: string, name: string) => ctx.uiWorkspace.createDirectory(path, name),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    createProject: async (path: string, enterpriseId: string | null, access?:{mode:'enterprise'|'selected';grants:ProjectGrant[]}) => {
      const project = await createOwnedProject(path, enterpriseId, {
        create: path => ctx.workspaces.create({ path }),
        assign: async (projectId, enterpriseId) => {
          const existing = controller.getSnapshot().catalog?.projects.find(project => project.id === projectId)
          if (enterpriseId || existing?.enterpriseId || pendingOwnership.has(projectId)) {
            pendingOwnership.add(projectId)
            await controller.call('/assign', { projectId, enterpriseId })
            pendingOwnership.delete(projectId)
          }
        },
      })
      await controller.load()
      if(access){
        const saved=controller.getSnapshot().catalog?.projects.find(p=>p.id===project.workspaceId)
        if(!saved?.cloudId)throw new Error('IPW_PROJECT_NOT_FOUND')
        await controller.call('/projects/'+saved.cloudId+'/access',access,'PUT')
      }
      return project
    },
  }
  const creationProps = () => ({ hooks: { enterpriseState: controller, enterpriseLabels: labels }, ...creation })
  const props = () => ({ ...creationProps(), hooks: { enterpriseState: controller, enterpriseLabels: labels, locale }, controller, actions, viewShare, openAccountSettings: account.openAccountSettings })
  for (const name of ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, priority: -100, inject: creationProps }, EnterpriseDirectoryFlow))
  }
  ctx.slots.inject('main', () => ctx.slots.register<Props>({ name: 'main', key: PANEL, inject: props }, EnterprisePanel))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register<Props>({ name: 'shell.overlay', id: 'ipollowork-enterprise-dialog', inject: props }, DialogHost))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'ipollowork-enterprise-toast', inject: () => ({ hooks: { enterpriseState: controller }, dismiss: controller.dismissToast }) }, ToastHost))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 9, label: () => enterpriseCopy(ctx).title }, IconWorkspaceTreeOutlineRegular))
  ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({ name: 'sidebar.session.row.trailing', id: 'ipollowork-enterprise.row', order: 30, inject: () => ({ hooks: { enterpriseState: controller, enterpriseLabels: labels } }) }, CollaborationMark))
  ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({name:'conversation.session.header.utilities',id:'liveshare-share',priority:-100,order:-7,inject:()=>({openShare,hooks:{enterpriseLabels:labels}})},ProjectShareAction))
  let userId: string | undefined
  const syncAccount = () => {
    const current = account.getSnapshot().account
    const next = current?.status === 'signed-in' ? current.user.id : undefined
    if (next === userId) return
    userId = next; controller.accountChanged(!!next)
  }
  syncAccount()
  ctx.effect(() => account.subscribe(syncAccount), 'ipollowork-suite: enterprise account')
  ctx.slots.inject('contextMenu.icon', function* () {
    yield ctx.slots.register({ name: 'contextMenu.icon', key: 'ipollowork.enterprise.share' }, IconShareOutlineRegular)
    yield ctx.slots.register({ name: 'contextMenu.icon', key: 'ipollowork.enterprise.ownership' }, IconWorkspaceTreeOutlineRegular)
  })
  ctx.effect(() => ctx.contextMenus.register({ id: 'ipollo.enterprise.project', target: 'workspace', order: 350, resolve: (value) => {
    if (!controller.getSnapshot().signedIn || !value.workspaceId) return []
    return [{ id: 'enterprise-ownership', label: enterpriseCopy(ctx).ownership, icon: { key: 'ipollowork.enterprise.ownership' }, run: async () => { await controller.load(); controller.open({ kind: 'assign', projectId: value.workspaceId! }) } }]
  } }), 'ipollowork-suite: project ownership action')
  for (const target of ['session', 'sessionHeader'] as const) {
    ctx.effect(() => ctx.contextMenus.register({ id: 'ipollo.enterprise.share.' + target, target, order: 350, resolve: (value) => {
      if (!value.sessionId) return []
      return [{ id: 'enterprise-share', label: enterpriseCopy(ctx).share, icon: { key: 'ipollowork.enterprise.share' }, run: () => openShare(value.sessionId!,value.displayTitle??'') }]
    } }), 'ipollowork-suite: conversation share action')
  }
}
