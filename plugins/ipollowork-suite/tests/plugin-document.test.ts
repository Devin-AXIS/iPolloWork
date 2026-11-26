import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readLocalizedPluginDocument } from '../src/host/plugin-document.ts'

test('older archives use only the requested localized README and honor native declarations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-plugin-detail-'))
  const read = (language: 'zh' | 'en') => readLocalizedPluginDocument('sample', '1.0.0', dir, language, new AbortController().signal)
  try {
    await writeFile(join(dir, 'README.md'), '# English original')
    assert.deepEqual(await read('en'), {})
    assert.deepEqual(await read('zh'), {})

    await writeFile(join(dir, 'README.zh.md'), '# 中文说明')
    assert.deepEqual(await read('zh'), { markdown: '# 中文说明', path: 'README.zh.md' })
    assert.deepEqual(await read('en'), {})

    await mkdir(join(dir, 'locale'))
    await writeFile(join(dir, 'locale/zh.json'), JSON.stringify({ meta: { detail: 'DETAIL.zh.md' } }))
    await writeFile(join(dir, 'DETAIL.zh.md'), '# 插件声明的中文说明')
    assert.deepEqual(await read('zh'), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('studio and Decision Intelligence translations apply only in their respective languages', async () => {
  const signal = new AbortController().signal
  const read = (name: string, language: 'zh' | 'en') => readLocalizedPluginDocument(name, undefined, undefined, language, signal)
  assert.match((await read('deepseek-idesign', 'zh')).markdown ?? '', /演示文稿/u)
  assert.match((await read('deepseek-ivideo', 'zh')).markdown ?? '', /时间轴/u)
  assert.deepEqual(await read('deepseek-idesign', 'en'), {})
  assert.match((await read('@ipollo/dsh-decision-intelligence', 'en')).markdown ?? '', /Decision Intelligence/)
  assert.deepEqual(await read('@ipollo/dsh-decision-intelligence', 'zh'), {})
})
