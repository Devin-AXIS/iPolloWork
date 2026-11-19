import assert from 'node:assert/strict'
import test from 'node:test'
import { publicationInputError } from '../src/shared/publication-validation.ts'

test('shared resources require meaningful metadata and a canonical pinned version', () => {
  const valid = { title: 'Team plugin', description: 'Shared team workflow', version: '1.0.0' }
  assert.equal(publicationInputError(valid), undefined)
  assert.equal(publicationInputError({ ...valid, version: '1.0.0-beta.1' }), undefined)
  for (const version of ['latest', '1', '1.0', 'v1.0.0', '^1.0.0', '1.0.0+build', '1.0.0\n'])
    assert.equal(publicationInputError({ ...valid, version }), 'PUBLICATION_VERSION_INVALID')
  assert.equal(publicationInputError({ ...valid, title: '  ' }), 'PUBLICATION_TITLE_REQUIRED')
  assert.equal(publicationInputError({ ...valid, description: '  ' }), 'PUBLICATION_DESCRIPTION_REQUIRED')
})
