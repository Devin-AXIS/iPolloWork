/** Enterprise departments, file packages, skills and models, each granted to everyone or to chosen departments and people. */
import { useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { Button, IconCheckOutlineRegular, IconChevronLeftOutlineRegular, IconDownloadOutlineRegular, IconEllipsisOutlineRegular, IconFolderCloseRegular,
  IconPlusOutlineRegular, IconSearchOutlineRegular, IconSkillOutlineRegular, IconSparkleRegular, IconTrashOutlineRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Audience, EnterpriseAssets, EnterpriseDetail, EnterpriseModel, ModelProbe, PackageDetail } from '../shared/enterprise.ts'
import type { EnterpriseController } from './enterprise-controller.ts'
import { enterpriseError, format, type EnterpriseLabels } from './enterprise-locale.ts'
import { EmptyState, FormError, ListSkeleton, Notice, When, useRecord, useTask, type Call } from './enterprise-ui.tsx'
import { KeyGlyph, Monogram } from './glyphs.tsx'
import css from './suite.module.css'

type Kind = 'package' | 'skill' | 'service'
export interface AssetProps { enterpriseId: string; detail: EnterpriseDetail; t: EnterpriseLabels; call: Call; controller: EnterpriseController; revision: number; language: string }
const everyone: Audience = { all: true, departments: [], members: [] }
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`

/** Assets and enterprise models for one enterprise, reloaded with the controller revision. */
export function useEnterpriseAssets(enterpriseId: string, call: Call, revision: number) {
  const assets = useRecord<EnterpriseAssets>('/organizations/' + enterpriseId + '/assets', call, revision)
  const models = useRecord<EnterpriseModel[]>('/organizations/' + enterpriseId + '/services', call, revision)
  return { assets, models }
}

function Toggle({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange(next: boolean): void }) {
  return <button type="button" role="switch" className={css.toggle} aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span/></button>
}

/** A compact description of an audience; managers can click it to change access. */
export function AudiencePill({ audience, detail, t, onEdit }: { audience: Audience; detail: EnterpriseDetail; t: EnterpriseLabels; onEdit?: () => void }) {
  const names = audience.departments.map(id => detail.departments.find(d => d.id === id)?.name).filter((name): name is string => !!name)
  const label = audience.all ? t.everyoneAccess : !names.length && !audience.members.length ? t.managersOnly
    : [...names.slice(0, 2), names.length > 2 ? `+${names.length - 2}` : '', audience.members.length ? format(t.peopleCount, { count: audience.members.length }) : ''].filter(Boolean).join(' · ')
  const body = <><span className={css.accessDot} data-scope={audience.all ? 'all' : names.length || audience.members.length ? 'some' : 'none'}/>{label}</>
  return onEdit ? <button type="button" className={css.accessPill} title={t.accessTitle} onClick={onEdit}>{body}</button> : <span className={css.accessPill} data-static="">{body}</span>
}

/** Choose everyone, or departments and individual members, for one asset. */
export function AccessDialog({ kind, assetId, title, audience, detail, t, enterpriseId, call, controller, close }: AssetProps & { kind: Kind; assetId: string; title: string; audience: Audience; close(): void }) {
  const task = useTask(t)
  const [all, setAll] = useState(audience.all), [departments, setDepartments] = useState(new Set(audience.departments)), [members, setMembers] = useState(new Set(audience.members))
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const people = detail.members.filter(m => m.role !== 'owner' && m.role !== 'admin' && (!needle || m.name.toLocaleLowerCase().includes(needle) || m.email.toLocaleLowerCase().includes(needle)))
  const flip = <T,>(set: Set<T>, value: T) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next }
  const save = () => void task.run(async () => {
    await call('/organizations/' + enterpriseId + '/grants', { kind, assetId, audience: { all, departments: all ? [] : [...departments], members: all ? [] : [...members] } }, 'PUT')
    controller.notify(t.accessSaved); close(); await controller.load()
  })
  return <Modal open title={t.accessTitle} description={title} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}
    footer={<div className={css.dialogFooter}><span className={css.footerNote}>{t.accessHint}</span><Button variant="outline" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" disabled={task.busy} onClick={save}>{t.save}</Button></div>}>
    <div className={css.accessDialog}>
      <div className={css.accessAll}><span><strong>{t.everyoneAccess}</strong><small>{format(t.memberCount, { count: detail.members.length })}</small></span><Toggle checked={all} label={t.everyoneAccess} onChange={setAll}/></div>
      {!all && <>
        <section><h3>{t.departmentsLabel}</h3>
          {detail.departments.length ? <div className={css.chipRow}>{detail.departments.map(d => <button key={d.id} type="button" className={css.filterChip} aria-pressed={departments.has(d.id)} onClick={() => setDepartments(v => flip(v, d.id))}>
            {departments.has(d.id) && <IconCheckOutlineRegular size={12}/>}{d.name}<small>{detail.members.filter(m => m.departmentId === d.id).length}</small></button>)}</div>
            : <p className={css.quietLine}>{t.noDepartments}</p>}
        </section>
        <section><h3>{t.peopleLabel}</h3>
          <label className={css.miniSearch} data-wide=""><IconSearchOutlineRegular size={14}/><input placeholder={t.searchPeople} aria-label={t.searchPeople} value={query} onChange={e => setQuery(e.target.value)}/></label>
          <div className={css.pickList}>{people.map(m => {
            const inDepartment = !!m.departmentId && departments.has(m.departmentId), selected = members.has(m.userId) || inDepartment
            return <button key={m.userId} type="button" className={css.pickRow} aria-pressed={selected} disabled={inDepartment} onClick={() => setMembers(v => flip(v, m.userId))}>
              <Monogram id={m.email} label={m.name || m.email} size={24} round/><span><strong>{m.name}</strong><small>{inDepartment ? detail.departments.find(d => d.id === m.departmentId)?.name : m.email}</small></span>
              <i className={css.pickCheck}>{selected && <IconCheckOutlineRegular size={12}/>}</i></button>
          })}</div>
        </section>
      </>}
      <FormError message={task.error}/>
    </div>
  </Modal>
}

function RowMenu({ t, items, onSelect }: { t: EnterpriseLabels; items: { id: string; label: string; danger?: boolean }[]; onSelect(id: string): void }) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} portal align="end" onClose={() => setOpen(false)} items={items} onSelect={id => { setOpen(false); onSelect(id) }}
    anchor={<button type="button" className={css.iconGhost} aria-label={t.manage} onClick={() => setOpen(v => !v)}><IconEllipsisOutlineRegular size={15}/></button>}/>
}

function InlineCreate({ placeholder, label, busy, onCreate }: { placeholder: string; label: string; busy: boolean; onCreate(value: string): Promise<boolean> }) {
  const [value, setValue] = useState('')
  return <form className={css.inviteBar} onSubmit={e => { e.preventDefault(); void onCreate(value.trim()).then(done => { if (done) setValue('') }) }}>
    <label className={css.fieldPill}><IconPlusOutlineRegular size={14}/><input placeholder={placeholder} aria-label={placeholder} maxLength={120} value={value} disabled={busy} onChange={e => setValue(e.target.value)}/></label>
    <button type="submit" className={css.keySave} disabled={busy || !value.trim()}>{label}</button>
  </form>
}

/** Departments with their members and a switch per file package, skill and model they may use. */
export function DepartmentsTab(props: AssetProps) {
  const { enterpriseId, detail, t, call, controller, revision } = props
  const { assets, models } = useEnterpriseAssets(enterpriseId, call, revision)
  const [selected, setSelected] = useState<string | null>(detail.departments[0]?.id ?? null)
  const [renaming, setRenaming] = useState(false), [draft, setDraft] = useState('')
  const task = useTask(t)
  const department = detail.departments.find(d => d.id === selected) ?? detail.departments[0]
  const manage = detail.canManage
  const create = async (name: string) => {
    let done = false
    await task.run(async () => {
      const created = await call<{ id: string }>('/organizations/' + enterpriseId + '/departments', { name })
      setSelected(created.id); controller.notify(t.departmentAdded); done = true; await controller.load()
    })
    return done
  }
  if (!detail.departments.length) return <div className={css.teamView}>
    {manage && <InlineCreate placeholder={t.departmentName} label={t.addDepartment} busy={task.busy} onCreate={create}/>}
    <FormError message={task.error}/>
    <EmptyState title={t.noDepartments} hint={t.noDepartmentsHint}/>
  </div>
  if (!department) return null
  const people = detail.members.filter(m => m.departmentId === department.id), others = detail.members.filter(m => m.departmentId !== department.id && m.role !== 'owner')
  const setDepartment = (userId: string, departmentId: string | null) => task.run(async () => {
    const member = detail.members.find(m => m.userId === userId)!
    await call('/organizations/' + enterpriseId + '/members/' + userId, { role: member.role === 'admin' ? 'admin' : 'member', departmentId }, 'PATCH')
    controller.notify(t.memberSaved); await controller.load()
  })
  const grant = (kind: Kind, assetId: string, audience: Audience, on: boolean) => task.run(async () => {
    const departments = on ? [...new Set([...audience.departments, department.id])] : audience.departments.filter(id => id !== department.id)
    await call('/organizations/' + enterpriseId + '/grants', { kind, assetId, audience: { all: false, departments, members: audience.members } }, 'PUT')
    controller.notify(t.accessSaved); await controller.load()
  })
  const groups: { kind: Kind; title: string; icon: ReactNode; items: { id: string; title: string; meta: string; audience: Audience }[] }[] = [
    { kind: 'package', title: t.filesTab, icon: <IconFolderCloseRegular size={14}/>, items: assets.data?.packages.map(p => ({ id: p.id, title: p.title, meta: format(t.fileCount, { count: p.fileCount }), audience: p.audience })) ?? [] },
    { kind: 'skill', title: t.skillsTab, icon: <IconSkillOutlineRegular size={14}/>, items: assets.data?.skills.map(s => ({ id: s.id, title: s.title, meta: s.name, audience: s.audience })) ?? [] },
    { kind: 'service', title: t.modelsTab, icon: <IconSparkleRegular size={14}/>, items: models.data?.map(m => ({ id: m.id, title: m.title, meta: format(t.modelCount, { count: m.models.length }), audience: m.audience })) ?? [] },
  ]
  return <div className={css.departmentLayout}>
    <nav className={css.departmentNav} aria-label={t.departments}>
      {detail.departments.map(d => <button key={d.id} type="button" className={css.departmentItem} aria-current={d.id === department.id || undefined} onClick={() => { setSelected(d.id); setRenaming(false) }}>
        <Monogram id={d.id} label={d.name} size={24}/><span>{d.name}</span><small>{detail.members.filter(m => m.departmentId === d.id).length}</small></button>)}
      {manage && <form className={css.departmentAdd} onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement; void create(input.value.trim()).then(ok => { if (ok) input.value = '' }) }}>
        <IconPlusOutlineRegular size={13}/><input name="name" placeholder={t.addDepartment} aria-label={t.addDepartment} maxLength={120} required disabled={task.busy}/></form>}
    </nav>
    <div className={css.departmentDetail}>
      <header className={css.departmentHead}>
        {renaming ? <form className={css.chipInput} data-wide="" onSubmit={e => { e.preventDefault(); void task.run(async () => {
          await call('/organizations/' + enterpriseId + '/departments/' + department.id, { name: draft.trim() }, 'PATCH'); setRenaming(false); controller.notify(t.departmentRenamed); await controller.load()
        }) }}><input autoFocus value={draft} maxLength={120} aria-label={t.departmentName} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setRenaming(false) }}/>
          <button type="submit" aria-label={t.save} disabled={task.busy || !draft.trim()}><IconCheckOutlineRegular size={13}/></button></form>
          : <h2>{department.name}<small>{format(t.memberCount, { count: people.length })}</small></h2>}
        {manage && !renaming && <RowMenu t={t} items={[{ id: 'rename', label: t.rename }, { id: 'delete', label: t.deleteAction, danger: true }]} onSelect={id => {
          if (id === 'rename') { setDraft(department.name); setRenaming(true) }
          else controller.open({ kind: 'confirm', title: format(t.deleteDepartmentTitle, { name: department.name }), description: t.deleteDepartmentBody, confirmLabel: t.deleteAction,
            run: async () => { await call('/organizations/' + enterpriseId + '/departments/' + department.id, undefined, 'DELETE'); setSelected(null); controller.notify(t.departmentRemoved); await controller.load() } })
        }}/>}
      </header>
      <FormError message={task.error}/>
      <section className={css.departmentSection}>
        <div className={css.sectionHead}><h3>{t.departmentMembers}</h3>
          {manage && others.length > 0 && <AddMember t={t} members={others} onAdd={userId => void setDepartment(userId, department.id)}/>}</div>
        {people.length ? <div className={css.avatarList}>{people.map(m => <span key={m.userId} className={css.avatarChip}>
          <Monogram id={m.email} label={m.name || m.email} size={22} round/>{m.name}
          {manage && m.role !== 'owner' && <button type="button" aria-label={t.removeFromDepartment} title={t.removeFromDepartment} onClick={() => void setDepartment(m.userId, null)}>×</button>}</span>)}</div>
          : <p className={css.quietLine}>{t.noDepartmentMembers}</p>}
      </section>
      <section className={css.departmentSection}>
        <div className={css.sectionHead}><h3>{t.departmentAccess}</h3></div>
        {assets.error || models.error ? <Notice error={assets.error || models.error} t={t} retry={() => { assets.reload(); models.reload() }}/>
          : !assets.data || !models.data ? <ListSkeleton rows={2}/>
          : groups.every(g => !g.items.length) ? <p className={css.quietLine}>{t.noAssetsYet}</p>
          : groups.filter(g => g.items.length).map(group => <div key={group.kind} className={css.grantGroup}>
            <h4>{group.icon}{group.title}</h4>
            {group.items.map(item => {
              const on = item.audience.all || item.audience.departments.includes(department.id)
              return <div key={item.id} className={css.grantRow}>
                <span className={css.personText}><strong>{item.title}</strong><small>{item.audience.all ? t.viaEveryone : item.meta}</small></span>
                <Toggle checked={on} label={item.title} disabled={!manage || item.audience.all || task.busy} onChange={next => void grant(group.kind, item.id, item.audience, next)}/>
              </div>
            })}
          </div>)}
      </section>
    </div>
  </div>
}

function AddMember({ t, members, onAdd }: { t: EnterpriseLabels; members: EnterpriseDetail['members']; onAdd(userId: string): void }) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} portal align="end" dense onClose={() => setOpen(false)} items={members.map(m => ({ id: m.userId, label: m.name || m.email }))} onSelect={id => { setOpen(false); onAdd(id) }}
    anchor={<button type="button" className={css.filterChip} data-add="" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}><IconPlusOutlineRegular size={12}/>{t.addToDepartment}</button>}/>
}

/** File packages; opening one shows its files, upload and download. */
export function FilesTab(props: AssetProps) {
  const { enterpriseId, detail, t, call, controller, revision, language } = props
  const { assets } = useEnterpriseAssets(enterpriseId, call, revision)
  const [open, setOpen] = useState<string | null>(null), [access, setAccess] = useState<{ id: string; title: string; audience: Audience } | null>(null)
  const task = useTask(t)
  if (open) return <PackageView {...props} packageId={open} back={() => setOpen(null)}/>
  if (!assets.data) return assets.error ? <Notice error={assets.error} t={t} retry={assets.reload}/> : <ListSkeleton/>
  const manage = assets.data.canManage, packages = assets.data.packages
  return <div className={css.teamView}>
    {manage && <InlineCreate placeholder={t.packageName} label={t.newPackage} busy={task.busy} onCreate={async title => {
      let done = false
      await task.run(async () => {
        const created = await call<{ id: string }>('/organizations/' + enterpriseId + '/packages', { title }); controller.notify(t.packageCreated); done = true; setOpen(created.id); await controller.load()
      })
      return done
    }}/>}
    <FormError message={task.error}/>
    {!packages.length ? <EmptyState title={t.noPackages} hint={t.noPackagesHint}/> : <div className={css.peopleList}>{packages.map(p => <div key={p.id} className={css.person}>
      <button type="button" className={css.assetOpen} onClick={() => setOpen(p.id)}>
        <span className={css.assetTile} data-kind="package"><IconFolderCloseRegular size={16}/></span>
        <span className={css.personText}><strong>{p.title}</strong><small>{format(t.fileCount, { count: p.fileCount })} · {size(p.bytes)} · <When at={p.updatedAt} language={language}/></small></span>
      </button>
      <AudiencePill audience={p.audience} detail={detail} t={t} {...(manage ? { onEdit: () => setAccess({ id: p.id, title: p.title, audience: p.audience }) } : {})}/>
      <span className={css.personActions}>{manage && <RowMenu t={t} items={[{ id: 'delete', label: t.deleteAction, danger: true }]} onSelect={() => controller.open({ kind: 'confirm', title: format(t.deletePackageTitle, { name: p.title }), description: t.deletePackageBody, confirmLabel: t.deleteAction,
        run: async () => { await call('/organizations/' + enterpriseId + '/packages/' + p.id, undefined, 'DELETE'); await controller.load() } })}/>}</span>
    </div>)}</div>}
    {access && <AccessDialog {...props} kind="package" assetId={access.id} title={access.title} audience={access.audience} close={() => setAccess(null)}/>}
  </div>
}

function PackageView(props: AssetProps & { packageId: string; back(): void }) {
  const { enterpriseId, detail, t, call, controller, revision, language, packageId, back } = props
  const [local, setLocal] = useState(0)
  const record = useRecord<PackageDetail>('/organizations/' + enterpriseId + '/packages/' + packageId, call, revision + local)
  const [uploading, setUploading] = useState(false), [error, setError] = useState(''), [dragging, setDragging] = useState(false), [access, setAccess] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const manage = detail.canManage
  const base = '/ipollowork-suite/enterprise/organizations/' + encodeURIComponent(enterpriseId) + '/packages/' + encodeURIComponent(packageId)
  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length || uploading) return
    if (list.some(file => file.size > 24 * 1024 * 1024)) { setError(t.fileTooLarge); return }
    setUploading(true); setError('')
    try {
      for (const file of list) {
        const form = new FormData(); form.set('file', file)
        const response = await fetch(base + '/upload', { method: 'POST', credentials: 'same-origin', body: form })
        if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? 'IPW_FILE_TRANSFER_FAILED')
      }
      controller.notify(format(t.filesUploaded, { count: list.length })); setLocal(v => v + 1); await controller.load()
    } catch (cause) { setError(enterpriseError(cause instanceof Error ? cause.message : '', t)) } finally { setUploading(false); if (input.current) input.current.value = '' }
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setDragging(false); if (manage) void upload(e.dataTransfer.files) }
  const data = record.data
  return <div className={css.teamView}>
    <button type="button" className={css.quietBack} onClick={back}><IconChevronLeftOutlineRegular size={14}/>{t.filesTab}</button>
    {!data ? record.error ? <Notice error={record.error} t={t} retry={record.reload}/> : <ListSkeleton/> : <>
      <header className={css.departmentHead}><h2>{data.package.title}<small>{format(t.fileCount, { count: data.files.length })}</small></h2>
        <AudiencePill audience={data.package.audience} detail={detail} t={t} {...(manage ? { onEdit: () => setAccess(true) } : {})}/></header>
      {manage && <div className={css.dropZone} data-active={dragging || undefined} role="button" tabIndex={0} aria-busy={uploading}
        onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
        <IconDownloadOutlineRegular size={16}/>{uploading ? t.uploading : t.dropFiles}
        <input ref={input} type="file" multiple hidden onChange={e => { if (e.target.files) void upload(e.target.files) }}/>
      </div>}
      <FormError message={error}/>
      {!data.files.length ? <p className={css.quietLine}>{t.noFiles}</p> : <div className={css.peopleList}>{data.files.map(file => <div key={file.id} className={css.person}>
        <span className={css.assetTile} data-kind="file">{(file.name.split('.').pop() ?? '').slice(0, 4).toUpperCase() || '·'}</span>
        <span className={css.personText}><strong>{file.name}</strong><small>{size(file.bytes)} · {file.addedBy} · <When at={file.addedAt} language={language}/></small></span>
        <span className={css.personActions}>
          <a className={css.iconGhost} href={base + '/files/' + encodeURIComponent(file.id) + '/download'} aria-label={t.download} title={t.download}><IconDownloadOutlineRegular size={15}/></a>
          {manage && <button type="button" className={css.iconGhost} aria-label={t.remove} title={t.remove} onClick={() => controller.open({ kind: 'confirm', title: format(t.removeFileTitle, { name: file.name }), description: t.removeFileBody, confirmLabel: t.remove,
            run: async () => { await call('/organizations/' + enterpriseId + '/packages/' + packageId + '/files/' + file.id, undefined, 'DELETE'); setLocal(v => v + 1); await controller.load() } })}><IconTrashOutlineRegular size={15}/></button>}
        </span>
      </div>)}</div>}
      {access && <AccessDialog {...props} kind="package" assetId={packageId} title={data.package.title} audience={data.package.audience} close={() => setAccess(false)}/>}
    </>}
  </div>
}

/** Enterprise skills; granted members receive them in their own DSH skill list. */
export function SkillsTab(props: AssetProps) {
  const { enterpriseId, detail, t, call, controller, revision, language } = props
  const { assets } = useEnterpriseAssets(enterpriseId, call, revision)
  const [creating, setCreating] = useState(false), [access, setAccess] = useState<{ id: string; title: string; audience: Audience } | null>(null)
  if (!assets.data) return assets.error ? <Notice error={assets.error} t={t} retry={assets.reload}/> : <ListSkeleton/>
  const manage = assets.data.canManage, skills = assets.data.skills
  return <div className={css.teamView}>
    {manage && <div className={css.tabActions}><Button variant="primary" icon={<IconPlusOutlineRegular size={14}/>} onClick={() => setCreating(true)}>{t.newSkill}</Button></div>}
    {!skills.length ? <EmptyState title={t.noSkills} hint={t.noSkillsHint}/> : <div className={css.peopleList}>{skills.map(s => <div key={s.id} className={css.person}>
      <span className={css.assetTile} data-kind="skill"><IconSkillOutlineRegular size={16}/></span>
      <span className={css.personText}><strong>{s.title}<code className={css.skillName}>{s.name}</code></strong><small>{s.description} · <When at={s.updatedAt} language={language}/></small></span>
      <AudiencePill audience={s.audience} detail={detail} t={t} {...(manage ? { onEdit: () => setAccess({ id: s.id, title: s.title, audience: s.audience }) } : {})}/>
      <span className={css.personActions}>{manage && <RowMenu t={t} items={[{ id: 'delete', label: t.deleteAction, danger: true }]} onSelect={() => controller.open({ kind: 'confirm', title: format(t.deleteSkillTitle, { name: s.title }), description: t.deleteSkillBody, confirmLabel: t.deleteAction,
        run: async () => { await call('/organizations/' + enterpriseId + '/skills/' + s.id, undefined, 'DELETE'); await controller.load() } })}/>}</span>
    </div>)}</div>}
    {creating && <SkillDialog {...props} close={() => setCreating(false)}/>}
    {access && <AccessDialog {...props} kind="skill" assetId={access.id} title={access.title} audience={access.audience} close={() => setAccess(null)}/>}
  </div>
}

function SkillDialog({ enterpriseId, t, call, controller, close }: AssetProps & { close(): void }) {
  const task = useTask(t), file = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [content, setContent] = useState('')
  const importFile = async (picked: File | undefined) => {
    if (!picked) return
    const text = await picked.text()
    // A SKILL.md front matter supplies the name and description when the fields are still empty.
    const front = /^---\n([\s\S]*?)\n---\n?/.exec(text)
    const field = (key: string) => front?.[1]?.split('\n').find(line => line.startsWith(key + ':'))?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
    if (!title) setTitle(field('name') ?? picked.name.replace(/\.md$/i, ''))
    if (!description) setDescription(field('description') ?? '')
    setContent(front ? text.slice(front[0].length) : text)
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    await call('/organizations/' + enterpriseId + '/skills', { title: title.trim(), description: description.trim(), content: content.trim() }); controller.notify(t.skillCreated); close(); await controller.load()
  }) }
  return <Modal open title={t.newSkill} closeLabel={t.close} className={css.enterpriseModal + ' ' + css.enterpriseWide} onClose={() => { if (!task.busy) close() }}>
    <form className={css.assetForm} onSubmit={submit}>
      <div className={css.fieldStack}>
        <label className={css.stackField}><span>{t.skillTitle}</span><input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="brand-voice"/></label>
        <label className={css.stackField}><span>{t.skillDescription}</span><input required maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder={t.skillDescriptionHint}/></label>
      </div>
      <label className={css.stackArea}><span>{t.skillContent}<button type="button" className={css.inlineLink} onClick={() => file.current?.click()}>{t.importMarkdown}</button></span>
        <textarea required rows={10} maxLength={200000} value={content} onChange={e => setContent(e.target.value)} placeholder="# …"/></label>
      <input ref={file} type="file" accept=".md,text/markdown,text/plain" hidden onChange={e => void importFile(e.target.files?.[0])}/>
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button><Button variant="primary" type="submit" disabled={task.busy || !title.trim() || !description.trim() || !content.trim()}>{t.save}</Button></div>
    </form>
  </Modal>
}

const presets = [
  { id: 'deepseek', title: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'aliyun-bailian', title: '通义百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'moonshot', title: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'zhipu', title: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'volcengine', title: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'openai', title: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
] as const
/** Defaults for models picked from a provider listing. */
const MODEL_DEFAULTS = { contextWindow: 131072, maxTokens: 8192 }
function probeLine(t: EnterpriseLabels, result: ModelProbe, chat?: ModelProbe) {
  if (!result.ok) return result.reason === 'auth' ? t.keyRejected : result.reason === 'unreachable' ? t.unreachable : result.reason === 'timeout' ? t.timedOut : format(t.upstreamStatus, { status: result.status })
  return [format(t.connected, { ms: result.latency }), result.models.length ? format(t.modelCount, { count: result.models.length }) : '', chat ? (chat.ok ? t.chatOk : t.chatFailed) : ''].filter(Boolean).join(' · ')
}

/** Enterprise models connected with the enterprise's own key and granted by department. */
export function ModelsTab(props: AssetProps) {
  const { enterpriseId, detail, t, call, controller, revision } = props
  const { models } = useEnterpriseAssets(enterpriseId, call, revision)
  const [editing, setEditing] = useState<EnterpriseModel | null>(), [access, setAccess] = useState<EnterpriseModel | null>(null)
  const [results, setResults] = useState<Record<string, { result: ModelProbe; chat?: ModelProbe } | 'busy'>>({})
  const task = useTask(t)
  if (!models.data) return models.error ? <Notice error={models.error} t={t} retry={models.reload}/> : <ListSkeleton/>
  const manage = detail.canManage
  const test = (m: EnterpriseModel) => {
    setResults(r => ({ ...r, [m.id]: 'busy' }))
    void (async () => {
      try {
        const draft = { serviceId: m.id, baseUrl: m.baseUrl }
        const result = await call<ModelProbe>('/organizations/' + enterpriseId + '/services/probe', draft)
        const chat = result.ok && m.models[0] ? await call<ModelProbe>('/organizations/' + enterpriseId + '/services/probe', { ...draft, model: m.models[0].id }) : undefined
        setResults(r => ({ ...r, [m.id]: chat ? { result, chat } : { result } }))
      } catch { setResults(r => { const next = { ...r }; delete next[m.id]; return next }) }
    })()
  }
  const toggle = (m: EnterpriseModel) => task.run(async () => {
    await call('/organizations/' + enterpriseId + '/services', { id: m.id, title: m.title, baseUrl: m.baseUrl, models: m.models, enabled: !m.enabled }, 'PUT'); await controller.load()
  })
  return <div className={css.teamView}>
    {manage && <div className={css.tabActions}><span className={css.footerNote}>{t.noModelsHint}</span><Button variant="primary" icon={<IconPlusOutlineRegular size={14}/>} onClick={() => setEditing(null)}>{t.newModel}</Button></div>}
    <FormError message={task.error}/>
    {!models.data.length ? <EmptyState title={t.noModels} {...(manage ? {} : { hint: t.noModelsHint })}/> : <div className={css.peopleList}>{models.data.map(m => {
      const entry = results[m.id], done = entry && entry !== 'busy' ? entry : undefined, passed = done ? done.result.ok && (done.chat?.ok ?? true) : false
      const host = (() => { try { return new URL(m.baseUrl).host } catch { return m.baseUrl } })()
      return <div key={m.id} className={css.person}>
        <Monogram id={host} label={m.title} size={32}/>
        <span className={css.personText}><strong>{m.title}</strong>
          <small><i className={css.stateDot} data-state={!m.enabled ? 'off' : m.configured ? 'on' : 'warn'}/>{!m.enabled ? t.modelDisabled : m.configured ? t.modelEnabled : t.notConfigured} · {host} · {format(t.modelCount, { count: m.models.length })}</small></span>
        {done && <span className={css.probeChip} data-ok={passed}>{passed ? '✓' : '✕'} {probeLine(t, done.result, done.chat)}</span>}
        <AudiencePill audience={m.audience} detail={detail} t={t} {...(manage ? { onEdit: () => setAccess(m) } : {})}/>
        {manage && <span className={css.personActions}>
          <button type="button" className={css.quietButton} disabled={entry === 'busy' || !m.configured} onClick={() => test(m)}>{entry === 'busy' ? t.testing : t.test}</button>
          <Toggle checked={m.enabled} label={t.enabledLabel} disabled={task.busy} onChange={() => void toggle(m)}/>
          <RowMenu t={t} items={[{ id: 'edit', label: t.edit }, { id: 'delete', label: t.remove, danger: true }]} onSelect={id => {
            if (id === 'edit') setEditing(m)
            else controller.open({ kind: 'confirm', title: format(t.deleteModelTitle, { name: m.title }), description: t.deleteModelBody, confirmLabel: t.remove,
              run: async () => { await call('/organizations/' + enterpriseId + '/services/' + m.id, undefined, 'DELETE'); await controller.load() } })
          }}/>
        </span>}
      </div>
    })}</div>}
    {editing !== undefined && <ModelDialog {...props} model={editing} close={() => setEditing(undefined)}/>}
    {access && <AccessDialog {...props} kind="service" assetId={access.id} title={access.title} audience={access.audience} close={() => setAccess(null)}/>}
  </div>
}

function ModelDialog({ enterpriseId, t, call, controller, model, close }: AssetProps & { model: EnterpriseModel | null; close(): void }) {
  const task = useTask(t)
  const [preset, setPreset] = useState<string>(model ? presets.find(p => p.baseUrl === model.baseUrl)?.id ?? 'custom' : 'deepseek')
  const [title, setTitle] = useState(model?.title ?? presets[0].title), [baseUrl, setBaseUrl] = useState(model?.baseUrl ?? presets[0].baseUrl), [key, setKey] = useState('')
  const [chosen, setChosen] = useState(model?.models ?? []), [listed, setListed] = useState<string[]>([])
  const [probe, setProbe] = useState<{ result: ModelProbe; chat?: ModelProbe } | 'busy'>()
  const choose = (id: string) => {
    setPreset(id); setProbe(undefined); setListed([])
    const p = presets.find(x => x.id === id)
    setTitle(p?.title ?? ''); setBaseUrl(p?.baseUrl ?? '')
  }
  const draft = () => ({ baseUrl, ...(key ? { key } : model ? { serviceId: model.id } : {}) })
  const runProbe = () => void task.run(async () => {
    setProbe('busy')
    try {
      const result = await call<ModelProbe>('/organizations/' + enterpriseId + '/services/probe', draft())
      let selected = chosen
      if (result.ok && result.models.length) {
        setListed(result.models)
        if (!chosen.length) { selected = result.models.slice(0, result.models.length <= 6 ? 6 : 3).map(id => ({ id, name: id, ...MODEL_DEFAULTS })); setChosen(selected) }
      }
      const chat = result.ok && selected[0] ? await call<ModelProbe>('/organizations/' + enterpriseId + '/services/probe', { ...draft(), model: selected[0].id }) : undefined
      setProbe(chat ? { result, chat } : { result })
    } catch (cause) { setProbe(undefined); throw cause }
  })
  const flip = (id: string) => setChosen(list => list.some(m => m.id === id) ? list.filter(m => m.id !== id) : [...list, { id, name: id, ...MODEL_DEFAULTS }])
  const save = (e: FormEvent) => { e.preventDefault(); void task.run(async () => {
    await call('/organizations/' + enterpriseId + '/services', { ...(model ? { id: model.id } : {}), title: title.trim(), baseUrl, ...(key ? { key } : {}), models: chosen, enabled: model?.enabled ?? true }, 'PUT')
    controller.notify(t.modelSaved); close(); await controller.load()
  }) }
  const chips = useMemo(() => Array.from(new Set([...chosen.map(m => m.id), ...listed])), [chosen, listed])
  const done = probe && probe !== 'busy' ? probe : undefined, passed = done ? done.result.ok && (done.chat?.ok ?? true) : false
  return <Modal open title={model ? model.title : t.newModel} closeLabel={t.close} className={css.enterpriseModal!} onClose={() => { if (!task.busy) close() }}>
    <form className={css.assetForm} onSubmit={save}>
      <div className={css.presetGrid} role="radiogroup" aria-label={t.endpoint}>
        {presets.map(p => <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => choose(p.id)}><Monogram id={p.id} label={p.title} size={22}/>{p.title}</button>)}
        <button type="button" role="radio" aria-checked={preset === 'custom'} onClick={() => choose('custom')}><span className={css.presetCustom}><IconPlusOutlineRegular size={12}/></span>{t.custom}</button>
      </div>
      <div className={css.fieldStack}>
        <label className={css.stackField}><span>{t.skillTitle}</span><input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label className={css.stackField}><span>{t.endpoint}</span><input required type="url" value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setProbe(undefined) }} placeholder="https://…/v1"/></label>
        <label className={css.stackField}><span><KeyGlyph size={13}/>{t.apiKey}</span><input type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={model?.configured ? t.keySaved : t.pasteKey}/>
          <button type="button" className={css.inlineTest} disabled={probe === 'busy' || !baseUrl || (!key && !model?.configured)} onClick={runProbe}>{probe === 'busy' ? t.testing : t.test}</button></label>
      </div>
      {done && <p className={css.probeChip} data-ok={passed} data-wide="">{passed ? '✓' : '✕'} {probeLine(t, done.result, done.chat)}</p>}
      {chips.length > 0 && <div className={css.modelPicker}><small>{t.modelsToOffer}</small><div>{chips.map(id => <button key={id} type="button" aria-pressed={chosen.some(m => m.id === id)} onClick={() => flip(id)}>
        {chosen.some(m => m.id === id) && <IconCheckOutlineRegular size={11}/>}{id}</button>)}</div></div>}
      <FormError message={task.error}/>
      <div className={css.dialogFooter}><Button variant="outline" type="button" disabled={task.busy} onClick={close}>{t.cancel}</Button>
        <Button variant="primary" type="submit" disabled={task.busy || !title.trim() || !baseUrl || (!model && !key) || !chosen.length}>{t.save}</Button></div>
    </form>
  </Modal>
}

/** Counts across the enterprise with a shortcut to the matching tab. */
export function EnterpriseStats({ detail, assets, models, t, open }: { detail: EnterpriseDetail; assets: EnterpriseAssets | null; models: EnterpriseModel[] | null; t: EnterpriseLabels; open(tab: 'members' | 'departments' | 'files' | 'skills' | 'models'): void }) {
  const stats = [
    { tab: 'members' as const, label: t.statMembers, value: detail.members.length },
    { tab: 'departments' as const, label: t.statDepartments, value: detail.departments.length },
    { tab: 'files' as const, label: t.statPackages, value: assets?.packages.length },
    { tab: 'skills' as const, label: t.statSkills, value: assets?.skills.length },
    { tab: 'models' as const, label: t.statModels, value: models?.length },
  ]
  return <div className={css.statStrip}>{stats.map(s => <button key={s.tab} type="button" onClick={() => open(s.tab)}><strong>{s.value ?? '–'}</strong><span>{s.label}</span></button>)}</div>
}
