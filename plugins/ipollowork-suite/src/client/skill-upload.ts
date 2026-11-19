export const maxSkillFileBytes = 32_000

/** Uploaded instructions remain publication content until the existing review and grant flow approves them. */
export function parseSkillFile(name: string, bytes: Uint8Array): { markdown: string } | { error: string } {
  if (!/\.(md|markdown)$/i.test(name)) return { error: 'SKILL_FILE_TYPE_INVALID' }
  if (bytes.byteLength > maxSkillFileBytes) return { error: 'SKILL_FILE_TOO_LARGE' }
  let markdown: string
  try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return { error: 'SKILL_FILE_ENCODING_INVALID' } }
  if (markdown.includes('\u0000')) return { error: 'SKILL_FILE_ENCODING_INVALID' }
  if (!markdown.trim()) return { error: 'SKILL_FILE_EMPTY' }
  return { markdown }
}
