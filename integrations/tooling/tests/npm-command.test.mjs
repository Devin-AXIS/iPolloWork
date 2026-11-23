import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { npmCommand } from '../npm-command.mjs'

test('npm executes under the selected Node and preserves literal arguments without a command wrapper', () => {
  const root = mkdtempSync(join(tmpdir(), 'ipollo-npm-runtime-'))
  try {
    const cli = join(root, 'npm-cli.js'), output = join(root, 'observed.json')
    writeFileSync(cli, 'const nested=require("node:child_process").execFileSync("node",["-p","process.execPath"],{encoding:"utf8"}).trim();require("node:fs").writeFileSync(process.argv[2],JSON.stringify({node:process.execPath,nested,args:process.argv.slice(3)}))')
    const literal = 'a path; $(never execute) & spaces'
    const invocation = npmCommand([output, literal], { ...process.env, npm_execpath: cli })
    execFileSync(invocation.command, invocation.args, { env: invocation.env })
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), { node: process.execPath, nested: process.execPath, args: [literal] })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
