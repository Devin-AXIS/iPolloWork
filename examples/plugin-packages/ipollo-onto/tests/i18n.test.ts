import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import english from '../src/ui/locales/en.json'
import { resolveLocale, translateFor, translateMessage, setLocale } from '../src/ui/i18n'

test('translations preserve business values, unknown labels and literal API placeholders', () => {
  const businessName = '客户 {1} $& <公司>'
  assert.equal(
    translateFor('en', '打开记录 {0}', { 0: businessName }),
    `Open record ${businessName}`,
  )
  assert.equal(
    translateFor('zh-CN', '打开记录 {0}', { 0: businessName }),
    `打开记录 ${businessName}`,
  )
  assert.equal(translateFor('en', '公司股票'), '公司股票')
  assert.equal(translateFor('en', '__proto__'), '__proto__')
  assert.equal(translateFor('en', 'constructor'), 'constructor')
  assert.ok(translateFor('en', '地址需要本行参数时，用 {{value}} 标记。').includes('{{value}}'))
  assert.equal(translateFor('en', '插件标题', {}, { 插件标题: 'Plugin title' }), 'Plugin title')
  assert.equal(resolveLocale('zh-CN', 'en-US'), 'zh-CN')
  assert.equal(resolveLocale('en', 'zh-CN'), 'en')
  assert.equal(resolveLocale('invalid', 'zh-Hans'), 'zh-CN')
  setLocale('en')
  assert.equal(translateMessage('请填写「客户」'), 'Enter a value for “客户”')
  assert.equal(translateMessage('外部系统的错误详情'), '外部系统的错误详情')
  setLocale('zh-CN')
  assert.equal(translateMessage('请填写「客户」'), '请填写「客户」')
})

test('all explicit UI and bundled view translation keys have English entries with matching parameters', async () => {
  const missing: string[] = []
  async function check(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) await check(file)
      else if (/\.(tsx?|js)$/.test(file)) {
        const source = ts.createSourceFile(
          file,
          await readFile(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        )
        function visit(node: ts.Node) {
          if (ts.isCallExpression(node) && node.expression.getText(source) === 'tr') {
            const key = node.arguments[0]
            if (key && ts.isStringLiteral(key) && !Object.hasOwn(english, key.text))
              missing.push(`${file}: ${key.text}`)
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
  }
  await check('src/ui')
  await check('extensions')
  assert.deepEqual(missing, [])
  const parameters = (value: string) => [...new Set(value.match(/\{\d+\}/g) ?? [])].sort()
  for (const [key, value] of Object.entries(english))
    assert.deepEqual(parameters(value), parameters(key), key)
})
