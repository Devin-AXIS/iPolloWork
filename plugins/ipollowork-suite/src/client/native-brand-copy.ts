import type { ClientContext } from './native.ts'
import { language } from './locale.ts'

const pluginUi = '[data-plugin-panel], [data-install-phase], [data-plugin-update]'
const notices = '[role="dialog"], [role="alert"], [role="status"], [role="tooltip"]'
const settingsUi = '[data-shortcut-modal="settings"]'
const nativeCopy = [
  ['pluginManager', pluginUi, [
    'installBundledTitle', 'installGuideSafety', 'installProblemShipped', 'installUpgradeNotice',
    'reasonIncompatibleInstall', 'reasonIncompatibleInstalled', 'reasonIncompatibleVersion',
    'reasonIncompatibleVersionUnnamed', 'reasonStopProfile', 'reasonUnsupportedPlatform',
    'sourceTargetSpec', 'sourceTargetVersion', 'updateLostDetail', 'versionsBlocked', 'versionsBlockedDetail',
  ]],
  ['pluginMarket', pluginUi, ['exempted', 'incompatible', 'noCompatibleVersion', 'statusProvided']],
  ['pluginRecommendations', notices, ['restart-required', 'version-error']],
  ['creationRecommendations', notices, ['restart-required', 'sourceRetained']],
  ['remoteConnection', notices, ['addressDescription']],
  ['settings.agentPreset', settingsUi, ['sectionIntro', 'presetCordisDescription', 'createPluginDescription']],
  ['actionCards', settingsUi, ['settings.description']],
  ['conversation', notices, ['error.sessionInUse']],
  ['model', notices, ['error.sessionInUse']],
  ['sidebarBrowser', notices, ['error.application-origin']],
] as const

const previewCopy = {
  zh: [
    '欢迎使用 iPolloWork 预览版。你可以在工作区管理对话和项目文件，并从插件市场添加功能。',
    '开发者功能可在设置中开启。感谢你的试用和反馈。',
  ],
  en: [
    'Welcome to the iPolloWork preview. Manage conversations and project files in your workspaces, and add capabilities from the plugin market.',
    'Developer features are available in Settings. Thank you for trying iPolloWork and sharing your feedback.',
  ],
}

const technical = new Set([
  'sourceTargetSpec', 'sourceTargetVersion', 'versionsBlockedDetail', 'reasonIncompatibleVersion',
  'reasonIncompatibleVersionUnnamed', 'incompatible', 'noCompatibleVersion', 'exempted',
])
const restartReasons = [
  'restartReasonNoHmr', 'restartReasonPackageMoved', 'restartReasonHostModule',
  'restartReasonUnmanagedPlugin', 'restartReasonModuleComparison',
]
const placeholders = /({[a-zA-Z]\w*})/g
type Rule = { scope: string; replace(value: string): string | undefined }

function copyRules(ctx: ClientContext): Rule[] {
  const locale = language(ctx)
  const runtimeName = locale === 'zh' ? 'iPolloWork 插件运行环境' : 'iPolloWork plugin runtime'
  const brand = (value: string, name = 'iPolloWork') => value
    .replace(/DeepSeek Harness|\bDSH\b|\bdsh web\b/g, match => match === 'dsh web' ? name + ' Web' : name)
  const rules: Rule[] = []
  function add(scope: string, source: string, target: string) {
    if (source === target) return
    const parts = source.split(placeholders)
    if (parts.length === 1) {
      rules.push({ scope, replace: value => value === source ? target : undefined })
      return
    }
    const expression = new RegExp('^' + parts.map((part, index) => index % 2
      ? '([\\s\\S]*?)'
      : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$')
    rules.push({ scope, replace(value) {
      const match = expression.exec(value)
      if (match === null) return
      let index = 0
      return target.replace(placeholders, () => match[++index] ?? '')
    } })
  }
  for (const [namespace, scope, keys] of nativeCopy) {
    const t = ctx.locale.bind(namespace)
    for (const key of keys) {
      const source = t(key)
      add(scope, source, brand(source, technical.has(key) ? runtimeName : undefined))
    }
  }
  const manager = ctx.locale.bind('pluginManager')
  for (const key of ['restartNotice', 'installDoneRestart']) {
    const template = manager(key)
    for (const reason of ['', ...restartReasons.map(reason => manager(reason))]) {
      const source = template.replace('{reason}', () => reason).trimEnd()
      add(pluginUi, source, brand(source))
    }
  }
  const models = ctx.locale.bind('settings.models')
  const office = ctx.locale.bind('sidebarOffice')('unavailable')
  const previewError = ctx.locale.bind('sidebarDocumentPreview')('error.unavailable').replace('{message}', () => office)
  add('[data-textpreview-body]', previewError, brand(previewError))
  const preview = models('welcomeBody')
  if (preview.includes('DeepSeek Harness')) {
    preview.split('\n\n').forEach((paragraph, index) => {
      add('[role="dialog"] p', paragraph, previewCopy[locale][index] ?? brand(paragraph))
    })
  }
  return rules
}

/** The pinned client has single-owner dictionaries. Adapt specific native UI strings
 * when the Suite is active, while preserving the native controls and dynamic values. */
export function mountNativeBrandCopy(ctx: ClientContext): void {
  ctx.effect(() => {
    const root = document.body
    const changed = new Map<Text, { original: string; replacement: string }>()
    let rules = copyRules(ctx)
    const update = (node: Text) => {
      const parent = node.parentElement
      if (!parent || parent.closest('pre, code, [contenteditable="true"]') || !/DeepSeek Harness|\bDSH\b/.test(node.data)) return
      for (const rule of rules) {
        if (!parent.closest(rule.scope)) continue
        const replacement = rule.replace(node.data)
        if (replacement === undefined) continue
        changed.set(node, { original: node.data, replacement })
        node.data = replacement
        break
      }
    }
    const visit = (node: Node) => {
      if (!root.contains(node)) return
      if (node instanceof Text) { update(node); return }
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      for (let text = walker.nextNode(); text; text = walker.nextNode()) update(text as Text)
    }
    const restore = () => {
      for (const [node, { original, replacement }] of changed) {
        if (node.data === replacement) node.data = original
      }
      changed.clear()
    }
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') visit(record.target)
        else for (const node of record.addedNodes) visit(node)
      }
      for (const node of changed.keys()) if (!node.isConnected) changed.delete(node)
    })
    const unsubscribe = ctx.locale.subscribe(() => {
      restore()
      rules = copyRules(ctx)
      visit(root)
    })
    visit(root)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect(); unsubscribe(); restore() }
  }, 'ipollowork-suite: native product copy')
}
