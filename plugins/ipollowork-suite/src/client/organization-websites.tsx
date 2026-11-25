import { useState, useSyncExternalStore } from 'react'
import { FormButton, FormSelect, TextInput } from '../../../_shared/ui/controls.tsx'
import type { EnterpriseDetail } from '../shared/enterprise.ts'
import type { EnterpriseLabels } from './enterprise-locale.ts'
import type { OrganizationContext } from '../shared/organizations.ts'
import type { Props as EnterpriseProps } from './enterprise.tsx'
import type { AccountController } from './account-controller.ts'
import { ConfirmDialog, EmptyState, Field, FormError, ListSkeleton, Notice, Row, Section, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import css from './suite.module.css'

type Role = 'owner' | 'admin' | 'member'
type Website = { id: string; label: string; url: string; departmentId: string | null; role: Role | null; cookieNames?: string[] }
type List = { items: Array<Pick<Website, 'id' | 'label'>> }
type Document = { revision: number; items: Website[] }

export function OrganizationWebsitePanel({ account, controller, useEnterpriseLabels, useEnterpriseState }:
  Pick<EnterpriseProps, 'controller' | 'useEnterpriseLabels' | 'useEnterpriseState'> & { account: AccountController }) {
  const { account: signedIn, error } = useSyncExternalStore(account.subscribe, account.getSnapshot)
  const t = useEnterpriseLabels(value => value)
  const activeOrganization = useEnterpriseState(value => value.enterpriseId)
  const revision = useEnterpriseState(value => value.revision)
  return <section className={css.page + ' ' + css.enterprisePage} aria-label={t.organizationBrowser}>
    <section className={css.organizationSettingsCard}>
      <Notice error={error ?? ''} t={t} retry={() => { void account.refresh() }}/>
      {signedIn?.status === 'signed-in' ?
        <WebsiteDirectory key={signedIn.user.id} activeOrganization={activeOrganization} revision={revision} t={t} call={controller.call}/> :
        signedIn ? <EmptyState title={t.organizationBrowser}>
          <FormButton type="button" variant="outline" onClick={account.openAccountSettings}>{t.signIn}</FormButton>
        </EmptyState> : !error && <ListSkeleton rows={2}/>}
    </section>
  </section>
}

function WebsiteDirectory({ activeOrganization, revision, t, call }: {
  activeOrganization: string | null; revision: number; t: EnterpriseLabels; call: Call
}) {
  const memberships = useRecord<OrganizationContext>('/memberships', call, revision)
  const [selection, setSelection] = useState<string>()
  const organizations = memberships.data?.organizations ?? []
  const organization = organizations.find(value => value.id === selection) ??
    organizations.find(value => value.id === activeOrganization) ?? organizations[0]
  const path = organization ? '/organizations/' + organization.id + '/websites' : null
  const sites = useRecord<List>(path, call, revision)
  const task = useTask(t)
  return <Section title={t.organizationBrowser} actions={<FormButton type="button" variant="outline" onClick={() => {
    memberships.reload()
    sites.reload()
  }}>{t.refresh}</FormButton>}>
    <Notice error={memberships.error || sites.error} t={t}/>
    {!memberships.data && !memberships.error && <ListSkeleton rows={2}/>}
    {memberships.data && !organizations.length && <p className={css.quietLine}>{t.websiteOrganizationsEmpty}</p>}
    {organization && <Field label={t.title}><FormSelect value={organization.id} disabled={task.busy}
      onChange={event => { setSelection(event.target.value); task.setError('') }}>
      {organizations.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
    </FormSelect></Field>}
    {path && !sites.data && !sites.error && <ListSkeleton rows={2}/>}
    {sites.data && !sites.data.items.length && <p className={css.quietLine}>{t.noOrganizationWebsites}</p>}
    {path && sites.data?.items.map(item => <Row key={item.id} title={item.label}
      actions={<FormButton type="button" variant="outline" disabled={task.busy}
        onClick={() => { void task.run(() => openOrganizationWebsite(path + '/' + item.id, call)) }}>{t.openWebsite}</FormButton>}/>)}
    <FormError message={task.error}/>
  </Section>
}

export async function openOrganizationWebsite(path: string, call: Call) {
  if ((window as Window & { dshDesktop?: { organizationBrowser?: boolean } }).dshDesktop?.organizationBrowser) {
    await call(path + '/open', {}, 'POST')
    return
  }
  const { url } = await call<{ url: string }>(path)
  const destination = new URL(url)
  if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password)
    throw new Error('ORGANIZATION_WEBSITE_UNAVAILABLE')
  window.open(destination.href, '_blank', 'noopener,noreferrer')
}

function TicketSettings({ path, t, call }: { path: string; t: EnterpriseLabels; call: Call }) {
  const status = useRecord<{ endpoint: string; configured: boolean }>(path, call, 0)
  const [endpoint, setEndpoint] = useState<string>()
  const [credential, setCredential] = useState('')
  const [disabling, setDisabling] = useState(false)
  const task = useTask(t)
  const update = async (disable: boolean) => {
    await call(path, disable ? null : { endpoint: endpoint ?? status.data?.endpoint ?? '', credential }, 'PUT')
    setCredential('')
    setEndpoint(undefined)
    status.reload()
  }
  return <Section title={t.websiteTicket}>
    <Notice error={status.error} t={t} retry={status.reload}/>
    {status.data && <form className={css.enterpriseForm} onSubmit={event => {
      event.preventDefault()
      void task.run(() => update(false))
    }}>
      <Field label={t.websiteTicketEndpoint}><TextInput type="url" maxLength={2048} required
        value={endpoint ?? status.data.endpoint} disabled={task.busy} onChange={event => setEndpoint(event.target.value)}/></Field>
      <Field label={t.websiteTicketCredential}><TextInput type="password" autoComplete="new-password" maxLength={8192}
        placeholder={status.data.configured ? t.websiteTicketConfigured : undefined} required={!status.data.configured}
        value={credential} disabled={task.busy} onChange={event => setCredential(event.target.value)}/></Field>
      <div className={css.dialogFooter}>
        {status.data.configured && <FormButton type="button" variant="outline" disabled={task.busy}
          onClick={() => setDisabling(true)}>{t.websiteTicketDisable}</FormButton>}
        <FormButton type="submit" variant="primary" disabled={task.busy}>{t.save}</FormButton>
      </div>
      <FormError message={task.error}/>
    </form>}
    {disabling && <ConfirmDialog title={t.websiteTicketDisable} description={t.websiteTicketConfirm}
      confirmLabel={t.websiteTicketDisable} t={t} close={() => setDisabling(false)} run={() => update(true)}/>}
  </Section>
}

export function OrganizationWebsites({ detail, t, call }: { detail: EnterpriseDetail; t: EnterpriseLabels; call: Call }) {
  const path = '/organizations/' + detail.enterprise.id + '/websites'
  const available = useRecord<List>(path, call, 0)
  const manage = useRecord<Document>(detail.canManage ? path + '/manage' : null, call, 0)
  const document = manage.data
  const task = useTask(t)
  const [editing, setEditing] = useState<Website>()
  const [cookieNames, setCookieNames] = useState('')
  const [deleting, setDeleting] = useState<Website>()
  const roles: Record<Role, string> = { owner: t.websiteOwner, admin: t.admin, member: t.member }
  const items = document?.items ?? available.data?.items ?? []
  const entries = new Map(document?.items.map(item => [item.id, item]))
  const visibleIds = new Set(available.data?.items.map(item => item.id))
  const reload = () => { available.reload(); manage.reload() }
  const save = async (items: Website[]) => {
    if (!document) return
    await call(path + '/manage', { revision: document.revision, items }, 'PUT')
    setEditing(undefined)
    reload()
  }
  const open = (id: string) => void task.run(async () => {
    try {
      await openOrganizationWebsite(path + '/' + id, call)
    } catch (error) {
      reload()
      throw error
    }
  })
  return <div className={css.organizationSettingsCard}>
    <Section title={t.organizationWebsites} actions={document && !editing && document.items.length < 50 &&
      <FormButton type="button" variant="outline" disabled={task.busy} onClick={() => {
        task.setError('')
        setCookieNames('')
        setEditing({ id: crypto.randomUUID(), label: '', url: '', departmentId: null, role: null })
      }}>{t.addWebsite}</FormButton>}>
      <Notice error={manage.error || available.error} t={t} retry={reload}/>
      {!available.data && !available.error && <ListSkeleton rows={2}/>}
      {available.data && !items.length && !editing && <p className={css.quietLine}>{t.noOrganizationWebsites}</p>}
      {items.map(item => {
        const entry = entries.get(item.id)
        return <Row key={item.id} title={item.label}
          actions={<>
            {visibleIds.has(item.id) && <FormButton type="button" variant="outline" disabled={task.busy}
              onClick={() => open(item.id)}>{t.openWebsite}</FormButton>}
            {entry && <FormButton type="button" variant="outline" disabled={task.busy || !!editing}
              onClick={() => { task.setError(''); setCookieNames(entry.cookieNames?.join(', ') ?? ''); setEditing(entry) }}>{t.edit}</FormButton>}
          </>}/>
      })}
      {editing && document && <form className={css.enterpriseForm} onSubmit={event => {
        event.preventDefault()
        const current = document.items
        const edited = { ...editing, cookieNames: [...new Set(cookieNames.split(/[,，]/).map(value => value.trim()).filter(Boolean))] }
        const items = current.some(item => item.id === editing.id)
          ? current.map(item => item.id === editing.id ? edited : item) : [...current, edited]
        void task.run(() => save(items))
      }}>
        <Field label={t.name}><TextInput required maxLength={80} value={editing.label} disabled={task.busy}
          onChange={event => setEditing({ ...editing, label: event.target.value })}/></Field>
        <Field label={t.websiteUrl}><TextInput required type="url" maxLength={2048} value={editing.url} disabled={task.busy}
          onChange={event => setEditing({ ...editing, url: event.target.value })}/></Field>
        <Field label={t.websiteCookieNames}><TextInput maxLength={1600} autoComplete="off" value={cookieNames}
          disabled={task.busy} onChange={event => setCookieNames(event.target.value)}/></Field>
        <Field label={t.websiteDepartment}><FormSelect value={editing.departmentId ?? ''} disabled={task.busy}
          onChange={event => setEditing({ ...editing, departmentId: event.target.value || null })}>
          <option value="">{t.websiteAllDepartments}</option>
          {editing.departmentId && !detail.departments.some(department => department.id === editing.departmentId) &&
            <option value={editing.departmentId}>{t.websiteDepartmentUnavailable}</option>}
          {detail.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        </FormSelect></Field>
        <Field label={t.websiteRole}><FormSelect value={editing.role ?? ''} disabled={task.busy}
          onChange={event => setEditing({ ...editing, role: (event.target.value || null) as Role | null })}>
          <option value="">{t.websiteAllRoles}</option>
          {Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
        </FormSelect></Field>
        <div className={css.dialogFooter}>
          {document.items.some(item => item.id === editing.id) && <FormButton type="button" variant="outline" disabled={task.busy}
            onClick={() => setDeleting(editing)}>{t.remove}</FormButton>}
          <FormButton type="button" variant="outline" disabled={task.busy} onClick={() => { task.setError(''); setEditing(undefined) }}>{t.cancel}</FormButton>
          <FormButton type="submit" variant="primary" disabled={task.busy}>{t.save}</FormButton>
        </div>
      </form>}
      <FormError message={task.error}/>
      {deleting && document && <ConfirmDialog title={t.removeWebsite} description={deleting.label} confirmLabel={t.remove} t={t}
        close={() => setDeleting(undefined)} run={() => save(document.items.filter(item => item.id !== deleting.id))}/>}
    </Section>
    {editing && entries.has(editing.id) && <TicketSettings key={editing.id} path={path + '/' + editing.id + '/ticket-config'} t={t} call={call}/>}
  </div>
}
