/** Members, departments and invitations of one enterprise, managed inline on the enterprise page. */
import { useState, type FormEvent } from 'react'
import { Button, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconEllipsisOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseDetail, Invitation } from '../shared/enterprise.ts'
import type { EnterpriseController, EnterpriseDialog } from './enterprise-controller.ts'
import { enterpriseError, format, type EnterpriseLabels } from './enterprise-locale.ts'
import { RosterRequestError } from './api.ts'
import { CopyLink, EmptyState, Field, FormError, ListSkeleton, Notice, roleName, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import { MailGlyph, Monogram } from './glyphs.tsx'
import css from './suite.module.css'
import { FilePicker } from './file-picker.tsx'

interface MembersProps { enterpriseId: string; userId: string; revision: number; language?: string; t: EnterpriseLabels; call: Call; controller: EnterpriseController }

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

export function MembersTab({ enterpriseId, userId, revision, t, call, controller, language = 'zh' }: MembersProps) {
  const detail = useRecord<EnterpriseDetail>('/organizations/' + enterpriseId, call, revision)
  const [query, setQuery] = useState(''), [department, setDepartment] = useState<string | null>(null)
  const [addingDepartment, setAddingDepartment] = useState(false), [departmentName, setDepartmentName] = useState('')
  const [batch, setBatch] = useState(false)
  const [editingCode, setEditingCode] = useState<Invitation>()
  const task = useTask(t)
  if (!detail.data) return detail.error ? <Notice error={detail.error} t={t} retry={detail.reload}/> : <ListSkeleton/>
  const data = detail.data, needle = query.trim().toLocaleLowerCase()
  const members = data.members.filter(m => (department === null || m.departmentId === department)
    && (!needle || [m.name, m.email, m.employeeNumber].some(value => value?.toLocaleLowerCase().includes(needle))))
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
  return <div className={css.teamView}>
    {data.canManage && <div className={css.tabActions}>
      <Button variant="outline" onClick={() => setBatch(true)}>{t.batchJoinCodes}</Button>
      <Button variant="primary" icon={<IconPlusOutlineRegular size={14}/>}
        onClick={() => controller.open({kind:'joinCode',enterpriseId})}>{t.addEmployee}</Button>
    </div>}
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
    <FormError message={task.error}/>
    <div className={css.peopleList}>
      {members.map(m => <div key={m.userId} className={css.person}>
        <Monogram id={m.email} label={m.name || m.email} size={32} round/>
        <span className={css.personText}>
          <strong>{m.name}{m.userId === userId && <span className={css.youTag}>{t.you}</span>}</strong>
          <small title={m.email}>{m.email}</small>
          <small title={m.employeeNumber ?? undefined}>{t.employeeNumber} {m.employeeNumber || '—'}</small>
        </span>
        <ChoiceChip label={t.changeDepartment} value={m.departmentId ?? ''} options={departmentOptions} disabled={!data.canManage || m.role === 'owner' || task.busy}
          onChoose={id => update(m, { departmentId: id || null })}/>
        {m.role === 'owner' ? <span className={css.chip} data-tone="strong" data-static="">{t.admin}</span>
          : <ChoiceChip label={t.changeRole} value={m.role} options={roleOptions} tone={m.role === 'admin' ? 'strong' : 'plain'} disabled={!data.canManage || m.userId === userId || task.busy}
            onChoose={id => update(m, { role: id })}/>}
        <span className={css.chip} data-static="">
          {m.status === 'suspended' ? t.memberSuspended : t.memberActive}
        </span>
        <span className={css.personActions}>{data.canManage && m.role !== 'owner' && m.userId !== userId && <>
          <button type="button" className={css.quietButton} aria-label={t.editMember + ' · ' + m.name}
            onClick={() => controller.open({ kind:'member', enterpriseId, userId:m.userId })}>{t.edit}</button>
          <MemberMenu t={t}
            onRemove={() => controller.open({ kind: 'confirm', title: format(t.removeMemberTitle, { name: m.name }), description: t.removeMemberBody, confirmLabel: t.remove,
              run: async () => { await call('/organizations/' + enterpriseId + '/members/' + m.userId, undefined, 'DELETE'); controller.notify(t.memberRemoved); await controller.load() } })}/>
        </>}</span>
      </div>)}
      {!members.length && <p className={css.quietLine}>{t.noMembersMatch}</p>}
      {data.canManage && pending.map(i => {
        const expired = i.expiresAt !== null && i.expiresAt <= Date.now()
        return <div key={i.id} className={css.person} data-pending="">
          <span className={css.pendingAvatar} aria-hidden="true"><MailGlyph size={14}/></span>
          <span className={css.personText}>
            <strong>{[i.inviteeName, i.email].filter(Boolean).join(' · ') || t.invitationCode}</strong>
            {i.employeeNumber && <small title={i.employeeNumber}>{t.employeeNumber} {i.employeeNumber}</small>}
            <small>{expired ? t.expired : t.pending} · {roleName(i.role, t)} · {expiryLabel(i.expiresAt, t)}</small>
          </span>
          <span className={css.personActions}>
            {!i.email && !i.projectId && <button type="button" className={css.quietButton} onClick={() => setEditingCode(i)}>{t.editJoinCodeExpiry}</button>}
            <button type="button" className={css.quietButton} onClick={() => controller.open({ kind: 'confirm', title: t.revokeInviteTitle, description: t.revokeInviteBody, confirmLabel: t.revoke,
              run: async () => { await call('/organizations/' + enterpriseId + '/invitations/' + i.id, undefined, 'DELETE'); controller.notify(t.inviteRevoked); await controller.load() } })}>{t.revoke}</button>
          </span>
        </div>
      })}
    </div>
    {data.canManage && batch && <BatchCodesDialog enterpriseId={enterpriseId} t={t} call={call} controller={controller} language={language} close={() => setBatch(false)}/>}
    {data.canManage && editingCode && <CodeExpiryDialog key={editingCode.id} invitation={editingCode}
      enterpriseId={enterpriseId} t={t} call={call} controller={controller} close={() => setEditingCode(undefined)}/>}
  </div>
}

const dayMs = 86_400_000
function expiryLabel(expiresAt: number | null, t: EnterpriseLabels) {
  return expiresAt === null ? t.permanentJoinCode : format(t.joinCodeExpires, { date:new Date(expiresAt).toLocaleDateString() })
}

function DaysField({ t, days, setDays, busy, required = false }: {
  t: EnterpriseLabels; days: string; setDays(days: string): void; busy: boolean; required?: boolean
}) {
  return <Field label={t.invitationDays} {...(required ? {} : {hint:t.permanentJoinCodeHint})}>
    <input type="number" min={1} max={30} required={required} placeholder={required ? undefined : t.permanentJoinCode}
      value={days} onChange={event => setDays(event.target.value)} disabled={busy}/>
  </Field>
}

function CodeExpiryDialog({ invitation, enterpriseId, t, call, controller, close }: {
  invitation: Invitation; enterpriseId: string; t: EnterpriseLabels; call: Call; controller: EnterpriseController; close(): void
}) {
  const [days, setDays] = useState(() => invitation.expiresAt === null ? ''
    : String(Math.max(1, Math.min(30, Math.ceil((invitation.expiresAt - Date.now()) / dayMs)))))
  const task = useTask(t)
  return <Modal open title={t.editJoinCodeExpiry} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}>
    <form className={css.enterpriseForm} onSubmit={event => {
      event.preventDefault()
      void task.run(async () => {
        await call('/organizations/' + enterpriseId + '/join-codes/' + invitation.id, {days:days === '' ? null : Number(days)}, 'PATCH')
        controller.notify(t.saved)
        close()
        await controller.load()
      })
    }}>
      <p className={css.muted}>{expiryLabel(invitation.expiresAt, t)}</p>
      <DaysField t={t} days={days} setDays={setDays} busy={task.busy}/>
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button>
        <Button variant="primary" type="submit" disabled={task.busy}>{t.save}</Button></div>
    </form>
  </Modal>
}

type JoinCodeInput = Extract<EnterpriseDialog, { kind: 'joinCode' }>
export function JoinCodeDialog({ dialog, t, call, controller, departments }: { dialog: JoinCodeInput; t: EnterpriseLabels; call: Call; controller: EnterpriseController; departments: EnterpriseDetail['departments'] }) {
  const task = useTask(t)
  const [department, setDepartment] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [issued, setIssued] = useState<{code:string;serviceAddress:string;expiresAt:number|null}>()
  const [projectRole, setProjectRole] = useState<'view' | 'participate' | 'maintain'>(dialog.projectRole ?? 'view')
  const [days, setDays] = useState(dialog.projectId ? '7' : '')
  const close = () => controller.open(null)
  const submit = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    const scope = dialog.projectId ? {projectId:dialog.projectId,projectRole}
      : {departmentId:department || null, displayName:displayName.trim() || undefined}
    setIssued(await call('/organizations/' + dialog.enterpriseId + '/join-codes', {days:days === '' ? null : Number(days), ...scope}))
    await controller.load()
  }) }
  return <Modal open title={dialog.projectId ? t.createJoinCode : t.addEmployee} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}>
    {issued ? <div className={css.enterpriseForm}>
      <p className={css.muted}>{expiryLabel(issued.expiresAt, t)}</p>
      <CopyLink url={issued.serviceAddress} t={t} label={t.serviceAddress}/>
      <CopyLink url={issued.code} t={t} label={t.invitationCode}/>
      <div className={css.dialogFooter}><Button variant="primary" onClick={close}>{t.close}</Button></div></div>
      : <form className={css.enterpriseForm} onSubmit={submit}>
        {dialog.projectId ? <Field label={t.role}><select value={projectRole} disabled={task.busy} onChange={e => setProjectRole(e.target.value as typeof projectRole)}>
          <option value="view">{t.spaceView}</option><option value="participate">{t.spaceParticipate}</option><option value="maintain">{t.spaceMaintain}</option>
        </select></Field> :
          <>
            <Field label={t.name}><input value={displayName} maxLength={120} disabled={task.busy} onChange={event => setDisplayName(event.target.value)}/></Field>
            <Field label={t.department}><select value={department} onChange={e => setDepartment(e.target.value)} disabled={task.busy}><option value="">{t.unassigned}</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          </>
        }
        <DaysField t={t} days={days} setDays={setDays} busy={task.busy} required={Boolean(dialog.projectId)}/>
        <FormError message={task.error}/>
        <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy}>{t.createJoinCode}</Button></div>
      </form>}
  </Modal>
}

export function MemberDialog({ enterpriseId, userId, t, call, controller, detail }: { enterpriseId: string; userId: string; t: EnterpriseLabels; call: Call; controller: EnterpriseController; detail: EnterpriseDetail }) {
  const member = detail.members.find(m => m.userId === userId), task = useTask(t)
  const [role, setRole] = useState(member?.role === 'admin' ? 'admin' : 'member'), [department, setDepartment] = useState(member?.departmentId ?? '')
  const [status, setStatus] = useState(member?.status ?? 'active')
  const [employeeNumber, setEmployeeNumber] = useState(member?.employeeNumber ?? '')
  const [displayName, setDisplayName] = useState(member?.displayName ?? member?.name ?? '')
  const close = () => controller.open(null)
  if (!member) return null
  return <Modal open title={t.editMember} description={`${member.name} · ${member.email}`} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}>
    <form className={css.enterpriseForm} onSubmit={e => { e.preventDefault(); void task.run(async () => {
      await call('/organizations/' + enterpriseId + '/members/' + userId, { role, departmentId: department || null,
        ...(status !== (member.status ?? 'active') ? {status} : {}),
        ...(employeeNumber.trim() !== (member.employeeNumber ?? '') ? { employeeNumber: employeeNumber.trim() || null } : {}),
        ...(displayName.trim() !== member.name ? { displayName: displayName.trim() || null } : {}),
      }, 'PATCH')
      controller.notify(t.memberSaved); close(); await controller.load()
    }) }}>
      <div className={css.enterpriseColumns}>
        <Field label={t.role}><select value={role} onChange={e => setRole(e.target.value)} disabled={task.busy}><option value="member">{t.member}</option><option value="admin">{t.admin}</option></select></Field>
        <Field label={t.department}><select value={department} onChange={e => setDepartment(e.target.value)} disabled={task.busy}><option value="">{t.unassigned}</option>{detail.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      </div>
      <Field label={t.memberStatus} {...(status === 'suspended' ? {hint:t.memberSuspendedHint} : {})}>
        <select value={status} onChange={event => setStatus(event.target.value === 'suspended' ? 'suspended' : 'active')} disabled={task.busy}>
          <option value="active">{t.memberActive}</option><option value="suspended">{t.memberSuspended}</option>
        </select>
      </Field>
      <Field label={t.employeeNumber}><input value={employeeNumber} maxLength={64} disabled={task.busy} onChange={e => setEmployeeNumber(e.target.value)}/></Field>
      <Field label={t.name}><input value={displayName} maxLength={120} disabled={task.busy} onChange={e => setDisplayName(e.target.value)}/></Field>
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy}>{t.save}</Button></div>
    </form>
  </Modal>
}

export function NoEnterprise({ t, controller }: { t: EnterpriseLabels; controller: EnterpriseController }) {
  return <EmptyState title={t.empty} hint={t.createOrJoin}>
    <Button variant="outline" onClick={() => controller.open({ kind: 'joinService' })}>{t.joinByService}</Button>
    <Button variant="primary" onClick={() => controller.open({ kind: 'create' })}>{t.create}</Button>
  </EmptyState>
}

function rosterError(error: unknown, t: EnterpriseLabels) {
  const row = error instanceof RosterRequestError ? error.row : undefined
  const code = error instanceof Error ? error.message : ''
  const messages: Record<string, string> = {
    ROSTER_FILE_REQUIRED: t.rosterFileRequired,
    ROSTER_UNREADABLE: t.rosterUnreadable,
    INVITATION_CSV_EMPTY: t.rosterEmpty,
    INVITATION_CSV_TOO_LARGE: t.rosterTooLarge,
    INVITATION_CSV_TOO_MANY_ROWS: t.rosterTooManyRows,
    INVITATION_CSV_INVALID: row === undefined ? t.rosterInvalid : t.rosterInvalidRow,
    INVITATION_DUPLICATE: t.rosterDuplicate,
    DEPARTMENT_MISMATCH: t.rosterDepartmentMissing,
    INVALID_INPUT: t.rosterInvalidInput,
    IPW_INVALID_INPUT: t.rosterInvalidInput,
  }
  const localized = Object.hasOwn(messages, code) ? messages[code] : undefined
  const message = localized ?? enterpriseError(code, t, t.rosterUnknownResult)
  return row === undefined ? message : format(t.rosterErrorRow, { row }) + ' · ' + message
}

export function BatchCodesDialog({enterpriseId,t,call,controller,close,language = 'zh'}:{enterpriseId:string;t:EnterpriseLabels;call:Call;controller:EnterpriseController;close():void;language?:string}) {
  const [days,setDays] = useState('')
  const [result,setResult] = useState<{ csv: string; count: number }>()
  const task = useTask(t, error => rosterError(error, t))
  return <Modal open title={t.batchJoinCodes} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}>
    <form className={css.enterpriseForm} onSubmit={event=>{
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const file = form.get("roster");
      void task.run(async()=>{
        if (!(file instanceof File) || !file.size) throw new Error("ROSTER_FILE_REQUIRED")
        if (file.size > 256 * 1024) throw new Error("INVITATION_CSV_TOO_LARGE")
        let csv: string;
        try {
          csv = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())
        } catch {
          throw new Error("ROSTER_UNREADABLE")
        }
        const { items } = await call<{items:{name?:string;employeeNumber?:string;serviceAddress:string;code:string}[]}>(
          "/organizations/"+enterpriseId+"/join-codes/batch", {
            csv, days: days === '' ? null : Number(days),
            ...(form.has("createMissingDepartments") ? { createMissingDepartments: true } : {}),
          },
        );
        const exported = [[t.name,t.employeeNumber,t.serviceAddress,t.invitationCode].join(","),...items.map(item =>
          [item.name,item.employeeNumber,item.serviceAddress,item.code].map(value => {
            const field = value ?? "";
            return '"' + (/^[=+\-@\t\r]/.test(field) ? "'" : "") + field.replaceAll('"','""') + '"';
          }).join(","),
        )].join("\r\n");
        setResult({ csv: exported, count: items.length });
        await controller.load();
      });
    }}>
      <div><Button type="button" variant="outline" onClick={() => downloadCsv("employee-roster-template.csv", t.rosterHeaders + "\r\n")}>{t.downloadRoster}</Button></div>
      <FilePicker label={t.invitationCsv} hint={t.invitationCsvHint} language={language} name="roster" accept=".csv,text/csv" required disabled={task.busy} onSelect={() => { task.setError(''); setResult(undefined) }}/>
      <label><input name="createMissingDepartments" type="checkbox" disabled={task.busy}/> {t.rosterCreateDepartments}</label>
      <DaysField t={t} days={days} setDays={setDays} busy={task.busy}/>
      <FormError message={task.error}/>
      {result && <p className={css.quietLine} role="status">{format(t.rosterSuccess, { count: result.count })}</p>}
      <div className={css.dialogFooter}>
        {result && <Button type="button" variant="outline" onClick={() => downloadCsv("organization-join-codes.csv", result.csv)}>{t.invitationExport}</Button>}
        <Button type="submit" variant="primary" disabled={task.busy}>{t.batchJoinCodes}</Button>
      </div>
    </form>
  </Modal>;
}
function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv"}))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
