import { useSyncExternalStore } from 'react'
import english from './locales/en.json'

export type Locale = 'zh-CN' | 'en'
export const localeKey = 'ipollo-data.locale'
export function readPreference(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}
export function savePreference(key: string, value: string) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    // Preferences still apply for this session when browser storage is unavailable.
  }
}
export function resolveLocale(saved: string | null, browserLanguage = 'zh-CN'): Locale {
  return saved === 'en' || saved === 'zh-CN'
    ? saved
    : browserLanguage.toLowerCase().startsWith('zh')
      ? 'zh-CN'
      : 'en'
}
let locale = resolveLocale(
  readPreference(localeKey),
  typeof navigator === 'undefined' ? 'zh-CN' : navigator.language,
)
const listeners = new Set<() => void>()
const subscribe = (notify: () => void) => {
  listeners.add(notify)
  return () => listeners.delete(notify)
}
export const getLocale = () => locale
export function setLocale(next: Locale) {
  locale = next
  savePreference(localeKey, next)
  listeners.forEach((notify) => notify())
}
export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, () => 'zh-CN' as Locale)
}
export function translateFor(
  language: Locale,
  source: string,
  values: Record<string, unknown> = {},
  messages: Record<string, string> = english,
): string {
  const template = language === 'en' && Object.hasOwn(messages, source) ? messages[source] : source
  return template.replace(/\{(\d+)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key] ?? '') : match,
  )
}
export const translate = (
  source: string,
  values?: Record<string, unknown>,
  messages?: Record<string, string>,
) => translateFor(locale, source, values, messages)

// Only known system messages are localized. Record names and values never pass through this.
const messagePatterns = Object.keys(english)
  .filter((key) => /\{\d+\}/.test(key) && /[\p{Script=Han}]/u.test(key))
  .sort((a, b) => b.length - a.length)
  .map((key) => {
    const parameters: string[] = []
    const pattern = key
      .split(/(\{\d+\})/)
      .map((part) => {
        if (/^\{\d+\}$/.test(part)) {
          parameters.push(part.slice(1, -1))
          return '([\\s\\S]*?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    return { key, parameters, pattern: new RegExp(`^${pattern}$`) }
  })
export function translateMessage(source: string): string {
  if (locale !== 'en' || !source) return source
  if (Object.hasOwn(english, source)) return translate(source)
  for (const { key, parameters, pattern } of messagePatterns) {
    const match = pattern.exec(source)
    if (match)
      return translate(key, Object.fromEntries(parameters.map((p, i) => [p, match[i + 1]])))
  }
  return source
}
