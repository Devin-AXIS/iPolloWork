/** Display the installed desktop release in General Settings' existing version row. */
import { useEffect, useState } from 'react'
import type { ClientContext } from './native.ts'
import css from './suite.module.css'

export function mountCurrentVersion(ctx: ClientContext): void {
  const { dshDesktop } = window as Window & {
    dshDesktop?: { protocolVersion: number; appVersion?: () => Promise<string> }
  }
  const getVersion = dshDesktop?.protocolVersion === 1 ? dshDesktop.appVersion : undefined
  if (getVersion === undefined) return

  const DesktopVersionRow = ({ t }: { t: (key: 'general.currentVersion', data: { version: string }) => string }) => {
    const [version, setVersion] = useState<string>()
    useEffect(() => {
      let mounted = true
      void getVersion().then(value => { if (mounted) setVersion(value) }, () => {})
      return () => { mounted = false }
    }, [])
    return version === undefined ? null : <div className={css.currentVersion}>{t('general.currentVersion', { version })}</div>
  }

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'current-version', order: 100, priority: -100, locale: 'settings',
  }, DesktopVersionRow))
}
