import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseDetail } from '../shared/enterprise.ts'
import type { EnterpriseController } from './enterprise-controller.ts'
import type { EnterpriseLabels } from './enterprise-locale.ts'
import { CopyLink, Field, FormError, Row, Section, useTask, type Call } from './enterprise-ui.tsx'
import css from './suite.module.css'

export function EnterpriseSettings({ detail, t, call, controller, serviceAddress }: {
  detail: EnterpriseDetail; t: EnterpriseLabels; call: Call; controller: EnterpriseController; serviceAddress: string;
}) {
  const { enterprise, canManage } = detail
  const [name, setName] = useState<string>()
  const [description, setDescription] = useState<string>()
  const [logo, setLogo] = useState<string | null>()
  const task = useTask(t)
  const value = name ?? enterprise.name
  const summary = description ?? detail.description ?? ''
  const shownLogo = logo === undefined ? enterprise.logo : logo
  const changed = value.trim().length > 0 && (value.trim() !== enterprise.name ||
    summary !== (detail.description ?? '') || shownLogo !== enterprise.logo)
  return <div className={css.organizationSettings}>
    <div className={css.organizationSettingsCard}>
      <Section title={t.organizationProfile}>
        {canManage ? <form className={css.enterpriseForm} onSubmit={event => {
          event.preventDefault()
          if (!changed) return
          void task.run(async () => {
            const saved = await call<{ name: string; description: string; logo:string|null }>(
              '/organizations/' + enterprise.id, {name:value.trim(), description:summary, logo:shownLogo ?? null}, 'PATCH')
            setName(saved.name)
            setDescription(saved.description)
            setLogo(saved.logo)
            controller.notify(t.settingsSaved)
            await controller.load()
          })
        }}>
          <div className={css.organizationProfileFields}>
            <div className={css.organizationProfileText}>
              <Field label={t.name}><input required maxLength={120} disabled={task.busy} value={value} onChange={event => setName(event.target.value)}/></Field>
              <Field label={t.organizationDescription}><textarea rows={3} maxLength={1000} disabled={task.busy} value={summary} onChange={event => setDescription(event.target.value)}/></Field>
            </div>
            <div className={css.organizationBrand}>
              {shownLogo && <img className={css.organizationLogo} src={shownLogo} alt={t.organizationLogo}/>}
              <Field label={t.organizationLogo}><input type="file" accept="image/png,image/jpeg,image/webp" disabled={task.busy} onChange={event=>{
                const input = event.currentTarget, file = input.files?.[0]
                if (!file) return
                if (file.size > 35_000 || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
                  task.setError(t.organizationLogoInvalid)
                  input.value = ''
                  return
                }
                task.setError('')
                const reader = new FileReader()
                reader.onload = () => {
                  if (input.files?.[0] === file && typeof reader.result === 'string') setLogo(reader.result)
                }
                reader.readAsDataURL(file)
              }}/></Field>
              {shownLogo && <div><Button variant="outline" type="button" disabled={task.busy} onClick={()=>setLogo(null)}>{t.remove}</Button></div>}
            </div>
          </div>
          <FormError message={task.error}/>
          <div className={css.organizationSettingsFooter}><Button type="submit" variant="primary" disabled={task.busy || !changed}>{t.save}</Button></div>
        </form> : <>
          {shownLogo && <img className={css.organizationLogo} src={shownLogo} alt={t.organizationLogo}/>}
          <Row title={enterprise.name} meta={summary}/>
        </>}
      </Section>
    </div>
    <div className={css.organizationSettingsCard}>
      <Section title={t.serviceAddress}>
        <CopyLink url={serviceAddress} t={t} label={t.serviceAddress}/>
      </Section>
    </div>
  </div>
}
