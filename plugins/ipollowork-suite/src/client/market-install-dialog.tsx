import { useId, useState, useSyncExternalStore } from 'react'
import { Button, IconWarningOutlineRegular, Input, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { installPending, type MarketInstallation } from './market-installation.ts'
import type { Labels } from './locale.ts'
import { Field } from './enterprise-ui.tsx'

export function MarketInstallDialog({ installation, useLabels }: {
  installation: MarketInstallation
  useLabels<T>(selector: (value: Labels) => T): T
}) {
  const t = useLabels(value => value)
  const { task, open, manual, notice } = useSyncExternalStore(installation.subscribe, installation.getSnapshot)
  const formId = useId()
  const [spec, setSpec] = useState('')
  const [registry, setRegistry] = useState('')
  if (manual) return <Modal open={open} title={t.addPlugin} closeLabel={t.installClose} onClose={installation.hide}
    footer={<>
      <Button variant="outline" onClick={installation.hide}>{t.installClose}</Button>
      <Button variant="primary" type="submit" form={formId} disabled={!spec.trim()}>{t.install}</Button>
    </>}>
    <form id={formId} onSubmit={event => {
      event.preventDefault()
      void installation.startManual(spec, registry.trim(), t.addPlugin)
    }}>
      <Field label={t.installSpec}>
        <Input value={spec} placeholder="name@version" required onChange={event => setSpec(event.target.value)} />
      </Field>
      <Field label={t.installRegistry}>
        <Input type="url" pattern="https?://.+" value={registry} onChange={event => setRegistry(event.target.value)} />
      </Field>
    </form>
  </Modal>
  if (!task) return null

  const { phase, target, result, enabling, enableFailed, inspectionError } = task
  const pending = installPending(phase)
  const pendingBuilds = result?.pendingBuilds
  const diagnostic = phase === 'failed' ? inspectionError ?? result?.packageResult?.kind ?? result?.error?.code : undefined
  const status = {
    checking: t.installInspecting,
    starting: t.installing,
    installing: t.installing,
    cancelling: t.installCancelling,
    applying: t.installApplying,
    reconciling: t.installChecking,
    unconfirmed: t.installUnknown,
    done: enableFailed ? t.installEnableFailed : result?.application === 'restart-required' ? t.installRestart : result?.enabled ? t.enabled : t.installed,
    failed: t.installFailed,
    cancelled: t.installCancelled,
    unknown: t.installUnknown,
  }[phase]
  const background = pending || enabling || phase === 'unconfirmed'
  const title = target.version ? `${target.title} · ${target.version}` : result?.bundle ?? target.title

  return <>
    <Modal open={open} title={title}
      closeLabel={background ? t.installBackground : t.installClose} onClose={installation.hide}
      footer={<>
        {phase === 'installing' && <Button variant="outline" onClick={installation.cancel}>{t.installCancel}</Button>}
        {phase === 'failed' && <Button variant="primary" onClick={() => installation.retry(Boolean(pendingBuilds?.length))}>
          {inspectionError ? t.installEditSpec : pendingBuilds?.length ? t.installApprove : t.retry}
        </Button>}
        {phase === 'unconfirmed' && <Button variant="primary" onClick={installation.reconcile}>{t.installCheck}</Button>}
        {phase === 'done' && !result?.enabled && result?.application !== 'restart-required' &&
          <Button variant="primary" disabled={enabling} aria-busy={enabling} onClick={installation.enable}>{t.installEnable}</Button>}
        <Button variant="outline" onClick={installation.hide}>{background ? t.installBackground : t.installClose}</Button>
      </>}>
      <p role={phase === 'failed' || enableFailed ? 'alert' : 'status'}>{status}{diagnostic ? ` (${diagnostic})` : ''}</p>
      {pendingBuilds?.length ? <p>{t.installApprovalHint} <code>{pendingBuilds.join(', ')}</code></p> : null}
    </Modal>
    {notice && <Toast key={task.requestId} text={`${title} · ${status}`}
      {...phase === 'done' && !enableFailed ? { tone: 'success' } : { icon: <IconWarningOutlineRegular /> }}
      actions={[{ label: t.installView, prefix: ' · ', onClick: installation.show }]} onDone={installation.dismissNotice}/>}
  </>
}
