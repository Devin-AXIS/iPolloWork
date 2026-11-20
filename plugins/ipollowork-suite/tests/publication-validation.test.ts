import assert from 'node:assert/strict'
import test from 'node:test'
import { publicationInputError } from '../src/shared/publication-validation.ts'
import { maxSkillFileBytes, parseSkillFile } from '../src/client/skill-upload.ts'

test('shared resources require meaningful metadata and a canonical pinned version', () => {
  const valid = { title: 'Team plugin', description: 'Shared team workflow', version: '1.0.0' }
  assert.equal(publicationInputError(valid), undefined)
  assert.equal(publicationInputError({ ...valid, version: '1.0.0-beta.1' }), undefined)
  for (const version of ['latest', '1', '1.0', 'v1.0.0', '^1.0.0', '1.0.0+build', '1.0.0\n'])
    assert.equal(publicationInputError({ ...valid, version }), 'PUBLICATION_VERSION_INVALID')
  assert.equal(publicationInputError({ ...valid, title: '  ' }), 'PUBLICATION_TITLE_REQUIRED')
  assert.equal(publicationInputError({ ...valid, description: '  ' }), 'PUBLICATION_DESCRIPTION_REQUIRED')
})

test('self-authored resources and shared MCP configurations accept custom version labels', () => {
  for (const kind of ['template', 'skill', 'mcp'] as const) {
    for (const version of ['初版', '2026-11 第二版', 'v2', '1.0', '1.0+team'])
      assert.equal(publicationInputError({ title:'Team resource', description:'A shared resource', version }, kind), undefined)
    for (const version of ['', '.', '..', 'x/y', 'x\\y', 'x?y', 'x#y', 'x%2Fy', 'x\u0000y', 'x\ny', ' v2', 'v2 ', 'v'.repeat(65)])
      assert.equal(publicationInputError({ title:'Team resource', description:'A shared resource', version }, kind), 'PUBLICATION_VERSION_LABEL_INVALID')
  }
})

test('Skill files preserve UTF-8 Markdown and reject wrong types, oversized, empty or binary uploads', () => {
  const text = '---\nname: team-notes\ndescription: Notes\n---\n# 团队知识\n保留上传内容。'
  assert.deepEqual(parseSkillFile('SKILL.md',new TextEncoder().encode(text)),{ markdown:text })
  assert.deepEqual(parseSkillFile('notes.markdown',new TextEncoder().encode(text)),{ markdown:text })
  for (const [name,bytes,error] of [
    ['skill.zip',new Uint8Array(), 'SKILL_FILE_TYPE_INVALID'],
    ['SKILL.md',new Uint8Array(maxSkillFileBytes+1), 'SKILL_FILE_TOO_LARGE'],
    ['SKILL.md',new TextEncoder().encode(' \n '), 'SKILL_FILE_EMPTY'],
    ['SKILL.md',new Uint8Array([0xff,0xfe]), 'SKILL_FILE_ENCODING_INVALID'],
    ['SKILL.md',new Uint8Array([0x61,0]), 'SKILL_FILE_ENCODING_INVALID'],
  ] as const) assert.deepEqual(parseSkillFile(name,bytes),{ error })
})
