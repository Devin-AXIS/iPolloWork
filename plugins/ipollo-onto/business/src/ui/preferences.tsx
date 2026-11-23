import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Theme, DropdownMenu, IconButton } from '@radix-ui/themes'
import { GlobeIcon, MoonIcon, SunIcon, DesktopIcon } from '@radix-ui/react-icons'
import { readPreference, savePreference, useLocale, setLocale, translate as tr } from './i18n'

export type Appearance = 'system' | 'light' | 'dark'
export const appearanceKey = 'ipollo-data.appearance'
export function resolveAppearance(saved: string | null): Appearance {
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}
const Context = createContext<{
  appearance: Appearance
  resolved: 'light' | 'dark'
  setAppearance: (appearance: Appearance) => void
} | null>(null)

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const language = useLocale()
  const [appearance, updateAppearance] = useState(() =>
    resolveAppearance(readPreference(appearanceKey)),
  )
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const resolved = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const change = () => setSystemDark(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.appearance = resolved
    document.documentElement.style.colorScheme = resolved
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#111418' : '#ffffff')
  }, [resolved])
  useEffect(() => {
    document.documentElement.lang = language
    document.title =
      language === 'en' ? 'iPollo Onto · Projects & data' : 'iPollo Onto · 项目与数据'
  }, [language])
  return (
    <Context.Provider
      value={{
        appearance,
        resolved,
        setAppearance: (value) => {
          savePreference(appearanceKey, value)
          updateAppearance(value)
        },
      }}
    >
      <Theme
        appearance={resolved}
        accentColor="gray"
        grayColor="slate"
        radius="medium"
        scaling="100%"
      >
        {children}
      </Theme>
    </Context.Provider>
  )
}

export function PreferenceControls() {
  const language = useLocale()
  const preferences = useContext(Context)
  if (!preferences) return null
  const Icon =
    preferences.appearance === 'system'
      ? DesktopIcon
      : preferences.resolved === 'dark'
        ? MoonIcon
        : SunIcon
  return (
    <div className="preference-controls">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <IconButton variant="ghost" color="gray" aria-label={tr('外观')} title={tr('外观')}>
            <Icon />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Label>{tr('外观')}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={preferences.appearance}
            onValueChange={(v) => preferences.setAppearance(v as Appearance)}
          >
            <DropdownMenu.RadioItem value="light">
              <SunIcon />
              {tr('浅色')}
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="dark">
              <MoonIcon />
              {tr('深色')}
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="system">
              <DesktopIcon />
              {tr('跟随系统')}
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <IconButton variant="ghost" color="gray" aria-label={tr('语言')} title={tr('语言')}>
            <GlobeIcon />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Label>{tr('语言')}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={language}
            onValueChange={(v) => setLocale(v as 'zh-CN' | 'en')}
          >
            <DropdownMenu.RadioItem value="zh-CN">
              <span lang="zh-CN">简体中文</span>
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="en">
              <span lang="en">English</span>
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  )
}
