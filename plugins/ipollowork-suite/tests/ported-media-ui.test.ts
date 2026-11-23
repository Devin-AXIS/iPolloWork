import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

// Exercise the shipped workbench RPC functions against the service's public
// manifest: the former host used unprefixed aliases, whereas DSH uses action IDs.
test('both media workbenches call declared native service actions and retain legacy aliases', async () => {
  const base = new URL('../../media-studio/business/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('ipollowork.plugin.json', base), 'utf8'))
  const actions = new Set(manifest.resources.flatMap((resource: { actions?: { id: string }[] }) => (resource.actions ?? []).map(action => action.id)))
  for (const [file, name, verbs] of [
    ['image-studio.html', 'callService', ['status', 'load-image', 'import-image', 'generate-image', 'edit-image', 'capture-selection', 'save-edit']],
    ['video-console.html', 'call', ['status', 'jobs', 'submit', 'recover', 'import', 'read', 'inspect', 'local-edit']],
  ] as const) {
    const html = await readFile(new URL('ui/' + file, base), 'utf8')
    const source = html.match(new RegExp(`async function ${name}\\([^]*?\\n    }`))?.[0]
    assert(source, file)
    for (const native of [true, false]) {
      const requests: { name: string; arguments: unknown }[] = []
      const call = runInNewContext(`(${source})`, {
        window: { ipolloPortedHost: native },
        request: async (method: string, params: { name: string; arguments: unknown }) => {
          assert.equal(method, 'tools/call')
          requests.push(params)
          return { structuredContent: { received: true } }
        },
      }) as (verb: string, input: unknown) => Promise<{ received: boolean }>
      for (const verb of verbs) {
        const input = { requestId: 'fixture-only' }
        assert.equal((await call(verb, input)).received, true)
        const request = requests.at(-1)!
        assert.equal(request.arguments, input)
        if (native) assert(actions.has(request.name), `${file}: undeclared action ${request.name}`)
        else assert.equal(request.name, verb)
      }
    }
  }
})
