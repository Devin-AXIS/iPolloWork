/** Members, departments and invitations of one enterprise, managed inline on the enterprise page. */
import { useState, type FormEvent } from 'react'
import { Button, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconEllipsisOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseDetail } from '../shared/enterprise.ts'
import type { EnterpriseController, EnterpriseDialog } from './enterprise-controller.ts'
import { format, type EnterpriseLabels } from './enterprise-locale.ts'
import { CopyLink, EmptyState, Field, FormError, ListSkeleton, Notice, roleName, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import { MailGlyph, Monogram } from './glyphs.tsx'
import css from './suite.module.css'

interface MembersProps { enterpriseId: string; userId: string; revision: number; t: EnterpriseLabels; call: Call; controller: EnterpriseController }

/** A small chip that opens a native menu of choices and applies the selection immediately. */
function ChoiceChip({ label, value, options, onChoose, disabled = false, tone = 'plain' }: { label: string; value: string; options: { id: string; label: string }[]; onChoose(id: string): Promise<void>; disabled?: boolean; tone?: 'plain' | 'strong' }) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.id === value)?.label ?? ''
  if (disabled) return <span className={css.chip} data-tone={tone} data-static="">{current}</span>
  return <Menu open={open} portal align="end" dense selectedId={value} onClose={() => setOpen(false)}
    anchor={<button type="button" className={css.chip} data-tone={tone} aria-label={`${label}: ${current}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>{current}<IconChevronDownOutlineRegular size={11}/></button>}
    items={options} onSelect={id => { setOpen(false); if (id !== value) void onChoose(id) }}/>
}

function MemberMenu({ t, onRemove }: { t: EnterpriseLabels; onRemove(): void }) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} portal align="end" onClose={() => setOpen(false)}
    anchor={<button type="button" className={css.iconGhost} aria-label={t.manage} onClick={() => setOpen(v => !v)}><IconEllipsisOutlineRegular size={15}/></button>}
    items={[{ id: 'remove', label: t.remove, danger: true }]}
    onSelect={() => { setOpen(false); onRemove() }}/>
}

export function MembersTab({ enterpriseId, userId, revision, t, call, controller }: MembersProps) {
  const detail = useRecord<EnterpriseDetail>('/organizations/' + enterpriseId, call, revision)
  const [query, setQuery] = useState(''), [department, setDepartment] = useState<string | null>(null)
  const [addingDepartment, setAddingDepartment] = useState(false), [departmentName, setDepartmentName] = useState('')
  const [email, setEmail] = useState(''), [role, setRole] = useState<'member' | 'admin'>('member'), [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const task = useTask(t)
  if (!detail.data) return detail.error ? <Notice error={detail.error} t={t} retry={detail.reload}/> : <ListSkeleton/>
  const data = detail.data, needle = query.trim().toLocaleLowerCase()
  const members = data.members.filter(m => (department === null || m.departmentId === department)
    && (!needle || m.name.toLocaleLowerCase().includes(needle) || m.email.toLocaleLowerCase().includes(needle)))
  const pending = data.invitations.filter(i => !i.accepted && !i.revoked)
  const departmentOptions = [{ id: '', label: t.unassigned }, ...data.departments.map(d => ({ id: d.id, label: d.name }))]
  const roleOptions = [{ id: 'member', label: t.member }, { id: 'admin', label: t.admin }]
  const update = (member: EnterpriseDetail['members'][number], change: { role?: string; departmentId?: string | null }) => task.run(async () => {
    await call('/organizations/' + enterpriseId + '/members/' + member.userId, { role: change.role ?? member.role, departmentId: change.departmentId === undefined ? member.departmentId : change.departmentId }, 'PATCH')
    controller.notify(t.memberSaved); await controller.load()
  })
  const addDepartment = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    await call('/organizations/' + enterpriseId + '/departments', { name: departmentName.trim() })
    setDepartmentName(''); setAddingDepartment(false); controller.notify(t.departmentAdded); await controller.load()
  }) }
  const invite = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    const result = await call<{ url: string }>('/organizations/' + enterpriseId + '/invitations', { email: email.trim(), role, departmentId: department })
    setLink({ email: email.trim(), url: result.url }); setEmail(''); controller.notify(t.inviteCreated); await controller.load()
  }) }
  return <div className={css.teamView}>
    <div className={css.teamBar}>
      <div className={css.chipRow} role="group" aria-label={t.departments}>
        <button type="button" className={css.filterChip} aria-pressed={department === null} onClick={() => setDepartment(null)}>{t.allDepartments}<small>{data.members.length}</small></button>
        {data.departments.map(d => <button key={d.id} type="button" className={css.filterChip} aria-pressed={department === d.id} onClick={() => setDepartment(d.id)}>
          {d.name}<small>{data.members.filter(m => m.departmentId === d.id).length}</small></button>)}
        {data.canManage && (addingDepartment
          ? <form className={css.chipInput} onSubmit={addDepartment}><input autoFocus aria-label={t.departmentName} placeholder={t.departmentName} maxLength={120} value={departmentName} disabled={task.busy}
              onChange={e => setDepartmentName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setAddingDepartment(false); setDepartmentName('') } }}
              onBlur={() => { if (!departmentName.trim()) setAddingDepartment(false) }}/>
            <button type="submit" aria-label={t.addDepartment} disabled={task.busy || !departmentName.trim()}><IconCheckOutlineRegular size={13}/></button></form>
          : <button type="button" className={css.filterChip} data-add="" onClick={() => setAddingDepartment(true)}><IconPlusOutlineRegular size={12}/>{t.newDepartment}</button>)}
      </div>
      <label className={css.miniSearch}><IconSearchOutlineRegular size={14}/><input placeholder={t.searchMembers} aria-label={t.searchMembers} value={query} onChange={e => setQuery(e.target.value)}/></label>
    </div>
    {data.canManage && <form className={css.inviteBar} onSubmit={invite}>
      <label className={css.fieldPill}><MailGlyph size={15}/><input type="email" required placeholder={t.inviteByEmail} aria-label={t.email} value={email} disabled={task.busy} onChange={e => setEmail(e.target.value)}/></label>
      <div className={css.sourceSwitch} role="group" aria-label={t.role}>
        {roleOptions.map(o => <button key={o.id} type="button" aria-pressed={role === o.id} onClick={() => setRole(o.id as 'member' | 'admin')}>{o.label}</button>)}
      </div>
      <button type="submit" className={css.keySave} disabled={task.busy || !email.trim()}>{t.invite}</button>
    </form>}
    {link && <div className={css.linkNote}><span>{format(t.inviteSent, { email: link.email })}</span><CopyLink url={link.url} t={t}/>
      <button type="button" className={css.iconGhost} aria-label={t.dismiss} onClick={() => setLink(null)}><IconCloseOutlineRegular size={14}/></button></div>}
    <FormError message={task.error}/>
    <div className={css.peopleList}>
      {members.map(m => <div key={m.userId} className={css.person}>
        <Monogram id={m.email} label={m.name || m.email} size={32} round/>
        <span className={css.personText}><strong>{m.name}{m.userId === userId && <span className={css.youTag}>{t.you}</span>}</strong><small>{m.email}</small></span>
        <ChoiceChip label={t.changeDepartment} value={m.departmentId ?? ''} options={departmentOptions} disabled={!data.canManage || task.busy}
          onChoose={id => update(m, { departmentId: id || null })}/>
        {m.role === 'owner' ? <span className={css.chip} data-tone="strong" data-static="">{t.owner}</span>
          : <ChoiceChip label={t.changeRole} value={m.role} options={roleOptions} tone={m.role === 'admin' ? 'strong' : 'plain'} disabled={!data.canManage || m.userId === userId || task.busy}
            onChoose={id => update(m, { role: id })}/>}
        <span className={css.personActions}>{data.canManage && m.role !== 'owner' && m.userId !== userId && <MemberMenu t={t}
          onRemove={() => controller.open({ kind: 'confirm', title: format(t.removeMemberTitle, { name: m.name }), description: t.removeMemberBody, confirmLabel: t.remove,
            run: async () => { await call('/organizations/' + enterpriseId + '/members/' + m.userId, undefined, 'DELETE'); controller.notify(t.memberRemoved); await controller.load() } })}/>}</span>
      </div>)}
      {!members.length && <p className={css.quietLine}>{t.noMembersMatch}</p>}
      {data.canManage && pending.map(i => {
        const expired = i.expiresAt < Date.now()
        return <div key={i.id} className={css.person} data-pending="">
          <span className={css.pendingAvatar} aria-hidden="true"><MailGlyph size={14}/></span>
          <span className={css.personText}><strong>{i.email}</strong><small>{expired ? t.expired : t.pending} · {roleName(i.role, t)} · {new Date(i.expiresAt).toLocaleDateString()}</small></span>
          <span className={css.personActions}>
            <button type="button" className={css.quietButton} onClick={() => controller.open({ kind: 'invite', enterpriseId, email: i.email, role: i.role, replaces: i.id })}>{t.resend}</button>
            <button type="button" className={css.quietButton} onClick={() => controller.open({ kind: 'confirm', title: t.revokeInviteTitle, description: t.revokeInviteBody, confirmLabel: t.revoke,
              run: async () => { await call('/organizations/' + enterpriseId + '/invitations/' + i.id, undefined, 'DELETE'); controller.notify(t.inviteRevoked); await controller.load() } })}>{t.revoke}</button>
          </span>
        </div>
      })}
    </div>
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
