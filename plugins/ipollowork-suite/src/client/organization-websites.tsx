import { useState } from 'react'
import { FormButton, FormSelect, TextInput } from '../../../_shared/ui/controls.tsx'
import type { EnterpriseDetail } from '../shared/enterprise.ts'
import type { EnterpriseLabels } from './enterprise-locale.ts'
import { ConfirmDialog, Field, FormError, ListSkeleton, Notice, Row, Section, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import css from './suite.module.css'

type Role = 'owner' | 'admin' | 'member'
type Website = { id: string; label: string; url: string; departmentId: string | null; role: Role | null }
type List = { items: Array<Pick<Website, 'id' | 'label'>> }
type Document = { revision: number; items: Website[] }

export function OrganizationWebsites({ detail, t, call }: { detail: EnterpriseDetail; t: EnterpriseLabels; call: Call }) {
  const path = '/organizations/' + detail.enterprise.id + '/websites'
  const available = useRecord<List>(path, call, 0)
  const manage = useRecord<Document>(detail.canManage ? path + '/manage' : null, call, 0)
  const document = manage.data
  const task = useTask(t)
  const [editing, setEditing] = useState<Website>()
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
      const { url } = await call<{ url: string }>(path + '/' + id)
      const destination = new URL(url)
      if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password)
        throw new Error('ORGANIZATION_WEBSITE_UNAVAILABLE')
      window.open(destination.href, '_blank', 'noopener,noreferrer')
    } catch (error) {
      reload()
      throw error
    }
  })
  return <div className={css.organizationSettingsCard}>
    <Section title={t.organizationWebsites} actions={document && !editing && document.items.length < 50 &&
      <FormButton type="button" variant="outline" disabled={task.busy} onClick={() => {
        task.setError('')
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
              onClick={() => { task.setError(''); setEditing(entry) }}>{t.edit}</FormButton>}
          </>}/>
      })}
      {editing && document && <form className={css.enterpriseForm} onSubmit={event => {
        event.preventDefault()
        const current = document.items
        const items = current.some(item => item.id === editing.id)
          ? current.map(item => item.id === editing.id ? editing : item) : [...current, editing]
        void task.run(() => save(items))
      }}>
        <Field label={t.name}><TextInput required maxLength={80} value={editing.label} disabled={task.busy}
          onChange={event => setEditing({ ...editing, label: event.target.value })}/></Field>
        <Field label={t.websiteUrl}><TextInput required type="url" maxLength={2048} value={editing.url} disabled={task.busy}
          onChange={event => setEditing({ ...editing, url: event.target.value })}/></Field>
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
  </div>
}
