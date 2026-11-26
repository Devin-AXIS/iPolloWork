import { readFile } from 'node:fs/promises'
import { localFiles, markdownOf, readPackageDocument } from '@deepseek-ai/dsh-plugin-detail'

const maxDocumentBytes = 256 * 1024
const suppliedDocuments = {
  zh: new Map([['deepseek-idesign', 'design.zh.md'], ['deepseek-ivideo', 'video.zh.md']]),
  en: new Map([['@ipollo/dsh-decision-intelligence', 'decision-intelligence.en.md']]),
}

/** Adapt older packages whose localized README is present but has no native detail declaration. */
export async function readLocalizedPluginDocument(
  name: string, version: string | undefined, dir: string | undefined, language: 'zh' | 'en', signal: AbortSignal,
): Promise<{ markdown?: string; path?: string }> {
  const supplied = suppliedDocuments[language].get(name)
  const files = dir === undefined ? undefined : localFiles(dir, version ?? '')
  if (files) {
    const path = `README.${language}.md`
    const localized = await files.read(path, maxDocumentBytes, signal).catch(() => undefined)
    if (localized || supplied) {
      const native = await readPackageDocument(files, '', [language], maxDocumentBytes, signal).catch(() => undefined)
      if (native?.origin === 'locale') return {}
    }
    if (localized) {
      try { return { markdown: markdownOf(localized), path } }
      catch { /* Keep the native README when the alternative is invalid. */ }
    }
  }
  if (!supplied) return {}
  const markdown = await readFile(new URL(`../../docs/plugin-details/${supplied}`, import.meta.url), { encoding: 'utf8', signal })
  return { markdown }
}
