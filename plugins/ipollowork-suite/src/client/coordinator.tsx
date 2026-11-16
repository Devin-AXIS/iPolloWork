/** Fixed mode label for existing coordinator conversations. */
import type { ClientContext } from './native.ts'
import { agentLabelSource, type AgentLabels } from './agent-locale.ts'
import { COORDINATOR_PRESET } from '../shared/coordinator.ts'
import css from './suite.module.css'

interface Props {
  useAgentLabels<T>(selector: (labels: AgentLabels) => T): T;
}

function FixedCoordinatorMode({ useAgentLabels }: Pick<Props, 'useAgentLabels'>) {
  const t = useAgentLabels(value => value)
  return <span className={css.coordinatorMode}>{t.coordinator}</span>
}

/** Register the fixed mode label for existing coordinator conversations. */
export function mountCoordinator(ctx: ClientContext): void {
  const labels = agentLabelSource(ctx)
  let releaseMode: (() => void) | undefined
  const syncMode = () => {
    const active = Object.values(ctx.sessions.list.getSnapshot().byId).find(item => (item.retainedBy.mainView ?? 0) > 0)
    const fixed = active?.projectionValues.agentPreset === COORDINATOR_PRESET
    if (fixed && !releaseMode) releaseMode = ctx.slots.register({ name: 'conversation.hero.agentPreset', priority: -100, inject: () => ({ hooks: { agentLabels: labels } }) }, FixedCoordinatorMode)
    else if (!fixed && releaseMode) { releaseMode(); releaseMode = undefined }
  }
  ctx.slots.inject('conversation.hero.agentPreset', () => {
    const unsubscribe = ctx.sessions.list.subscribe(syncMode)
    syncMode()
    return () => { unsubscribe(); releaseMode?.(); releaseMode = undefined }
  })
}
