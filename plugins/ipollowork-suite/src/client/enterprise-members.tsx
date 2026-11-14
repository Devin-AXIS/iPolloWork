/** Members, departments and invitations of one enterprise, managed inline on the enterprise page. */
import { useState, type FormEvent } from 'react'
import { Button, IconEllipsisOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, Input, Menu, Modal, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseDetail } from '../shared/enterprise.ts'
import type { EnterpriseController, EnterpriseDialog } from './enterprise-controller.ts'
import { format, type EnterpriseLabels } from './enterprise-locale.ts'
import { CopyLink, EmptyState, Field, FormError, ListSkeleton, Notice, Row, Section, roleName, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import css from './suite.module.css'

interface MembersProps { enterpriseId: string; userId: string; revision: number; t: EnterpriseLabels; call: Call; controller: EnterpriseController }

function MemberMenu({ t, onEdit, onRemove }: { t: EnterpriseLabels; onEdit(): void; onRemove(): void }) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} portal align="end" onClose={() => setOpen(false)}
    anchor={<Button variant="ghost" size="sm" aria-label={t.manage} icon={<IconEllipsisOutlineRegular size={16}/>} onClick={() => setOpen(v => !v)}/>}
    items={[{ id: 'edit', label: t.edit }, { id: 'remove', label: t.remove, danger: true }]}
    onSelect={id => { setOpen(false); if (id === 'edit') onEdit(); else onRemove() }}/>
}

export function MembersTab({ enterpriseId, userId, revision, t, call, controller }: MembersProps) {
  const detail = useRecord<EnterpriseDetail>('/organizations/' + enterpriseId, call, revision)
  const [query, setQuery] = useState(''), [department, setDepartment] = useState<string | null>(null)
  const [departmentName, setDepartmentName] = useState(''), task = useTask(t)
  if (!detail.data) return detail.error ? <Notice error={detail.error} t={t} retry={detail.reload}/> : <ListSkeleton/>
  const data = detail.data, needle = query.trim().toLocaleLowerCase()
  const departmentName_ = (id: string | null) => data.departments.find(d => d.id === id)?.name ?? t.unassigned
  const members = data.members.filter(m => (department === null || m.departmentId === department)
    && (!needle || m.name.toLocaleLowerCase().includes(needle) || m.email.toLocaleLowerCase().includes(needle)))
  const pending = data.invitations.filter(i => !i.accepted && !i.revoked)
  const addDepartment = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    await call('/organizations/' + enterpriseId + '/departments', { name: departmentName })
    setDepartmentName(''); controller.notify(t.departmentAdded); await controller.load()
  }) }
  return <div className={css.enterpriseStack}>
    <Section title={t.members} meta={format(t.memberCount, { count: data.members.length })}
      actions={data.canManage && <Button variant="primary" icon={<IconPlusOutlineRegular size={14}/>} onClick={() => controller.open({ kind: 'invite', enterpriseId })}>{t.invite}</Button>}>
      <div className={css.memberFilters}>
        <Input className={css.memberSearch!} icon={<IconSearchOutlineRegular size={16}/>} placeholder={t.searchMembers} aria-label={t.searchMembers} value={query} onChange={e => setQuery(e.target.value)}/>
        {data.departments.length > 0 && <div className={css.pillRow} role="group" aria-label={t.departments}>
          <Pill active={department === null} onClick={() => setDepartment(null)}>{t.allDepartments}</Pill>
          {data.departments.map(d => <Pill key={d.id} active={department === d.id} onClick={() => setDepartment(d.id)}>{d.name}</Pill>)}
        </div>}
      </div>
      <div className={css.enterpriseList}>
        {members.map(m => <Row key={m.userId} title={<>{m.name}{m.userId === userId && <Tag tone="quiet">{t.you}</Tag>}</>} meta={`${m.email} · ${departmentName_(m.departmentId)}`}
          aside={<Tag tone={m.role === 'member' ? 'outline' : 'neutral'}>{roleName(m.role, t)}</Tag>}
          actions={data.canManage && m.role !== 'owner' && m.userId !== userId ? <MemberMenu t={t}
            onEdit={() => controller.open({ kind: 'member', enterpriseId, userId: m.userId })}
            onRemove={() => controller.open({ kind: 'confirm', title: format(t.removeMemberTitle, { name: m.name }), description: t.removeMemberBody, confirmLabel: t.remove,
              run: async () => { await call('/organizations/' + enterpriseId + '/members/' + m.userId, undefined, 'DELETE'); controller.notify(t.memberRemoved); await controller.load() } })}/> : undefined}/>)}
        {!members.length && <p className={css.quietLine}>{t.noMembersMatch}</p>}
      </div>
    </Section>
    {data.canManage && pending.length > 0 && <Section title={t.invitations} meta={String(pending.length)}>
      <div className={css.enterpriseList}>{pending.map(i => {
        const expired = i.expiresAt < Date.now()
        return <Row key={i.id} title={i.email} meta={`${roleName(i.role, t)} · ${new Date(i.expiresAt).toLocaleDateString()}`}
          aside={<Tag tone={expired ? 'outline' : 'neutral'}>{expired ? t.expired : t.pending}</Tag>}
          actions={<>
            <Button variant="ghost" size="sm" onClick={() => controller.open({ kind: 'invite', enterpriseId, email: i.email, role: i.role, replaces: i.id })}>{t.resend}</Button>
            <Button variant="ghost" size="sm" onClick={() => controller.open({ kind: 'confirm', title: t.revokeInviteTitle, description: t.revokeInviteBody, confirmLabel: t.revoke,
              run: async () => { await call('/organizations/' + enterpriseId + '/invitations/' + i.id, undefined, 'DELETE'); controller.notify(t.inviteRevoked); await controller.load() } })}>{t.revoke}</Button>
          </>}/>
      })}</div>
    </Section>}
    <Section title={t.departments} meta={String(data.departments.length)}>
      <div className={css.enterpriseList}>{data.departments.map(d => <Row key={d.id} title={d.name} meta={format(t.memberCount, { count: data.members.filter(m => m.departmentId === d.id).length })}/>)}</div>
      {data.canManage && <form className={css.inlineForm} onSubmit={addDepartment}>
        <Input aria-label={t.name} placeholder={t.addDepartment} required maxLength={120} value={departmentName} onChange={e => setDepartmentName(e.target.value)} disabled={task.busy}/>
        <Button variant="outline" type="submit" disabled={task.busy || !departmentName.trim()}>{t.addDepartment}</Button>
      </form>}
      <FormError message={task.error}/>
    </Section>
  </div>
}

type InviteDialogInput = Extract<EnterpriseDialog, { kind: 'invite' }>
/** Create an email-bound invitation; `replaces` revokes the earlier pending link after the new one exists. */
export function InviteDialog({ dialog, t, call, controller, departments }: { dialog: InviteDialogInput; t: EnterpriseLabels; call: Call; controller: EnterpriseController; departments: EnterpriseDetail['departments'] }) {
  const task = useTask(t)
  const [email, setEmail] = useState(dialog.email ?? ''), [role, setRole] = useState(dialog.role === 'admin' ? 'admin' : 'member'), [department, setDepartment] = useState(dialog.departmentId ?? '')
  const [link, setLink] = useState('')
  const close = () => controller.open(null)
  const submit = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    const result = await call<{ url: string }>('/organizations/' + dialog.enterpriseId + '/invitations', { email, role, departmentId: department || null })
    if (dialog.replaces) await call('/organizations/' + dialog.enterpriseId + '/invitations/' + dialog.replaces, undefined, 'DELETE')
    setLink(result.url); controller.notify(t.inviteCreated); await controller.load()
  }) }
  return <Modal open title={t.inviteTitle} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}>
    {link ? <div className={css.enterpriseForm}><p className={css.muted}>{format(t.inviteReady, { email })}</p><CopyLink url={link} t={t}/>
      <div className={css.dialogFooter}><Button variant="primary" onClick={close}>{t.close}</Button></div></div>
      : <form className={css.enterpriseForm} onSubmit={submit}>
        <Field label={t.email} hint={t.inviteHint}><input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} disabled={task.busy || !!dialog.replaces}/></Field>
        <div className={css.enterpriseColumns}>
          <Field label={t.role}><select value={role} onChange={e => setRole(e.target.value)} disabled={task.busy}><option value="member">{t.member}</option><option value="admin">{t.admin}</option></select></Field>
          <Field label={t.department}><select value={department} onChange={e => setDepartment(e.target.value)} disabled={task.busy}><option value="">{t.unassigned}</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        </div>
        <FormError message={task.error}/>
        <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy}>{dialog.replaces ? t.resend : t.invite}</Button></div>
      </form>}
  </Modal>
}

export function MemberDialog({ enterpriseId, userId, t, call, controller, detail }: { enterpriseId: string; userId: string; t: EnterpriseLabels; call: Call; controller: EnterpriseController; detail: EnterpriseDetail }) {
  const member = detail.members.find(m => m.userId === userId), task = useTask(t)
  const [role, setRole] = useState(member?.role === 'admin' ? 'admin' : 'member'), [department, setDepartment] = useState(member?.departmentId ?? '')
  const close = () => controller.open(null)
  if (!member) return null
  return <Modal open title={t.editMember} description={`${member.name} · ${member.email}`} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}>
    <form className={css.enterpriseForm} onSubmit={e => { e.preventDefault(); void task.run(async () => {
      await call('/organizations/' + enterpriseId + '/members/' + userId, { role, departmentId: department || null }, 'PATCH')
      controller.notify(t.memberSaved); close(); await controller.load()
    }) }}>
      <div className={css.enterpriseColumns}>
        <Field label={t.role}><select value={role} onChange={e => setRole(e.target.value)} disabled={task.busy}><option value="member">{t.member}</option><option value="admin">{t.admin}</option></select></Field>
        <Field label={t.department}><select value={department} onChange={e => setDepartment(e.target.value)} disabled={task.busy}><option value="">{t.unassigned}</option>{detail.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      </div>
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy}>{t.save}</Button></div>
    </form>
  </Modal>
}

export function NoEnterprise({ t, controller }: { t: EnterpriseLabels; controller: EnterpriseController }) {
  return <EmptyState title={t.empty} hint={t.createOrJoin}>
    <Button variant="outline" onClick={() => controller.open({ kind: 'join' })}>{t.join}</Button>
    <Button variant="primary" onClick={() => controller.open({ kind: 'create' })}>{t.create}</Button>
  </EmptyState>
}
