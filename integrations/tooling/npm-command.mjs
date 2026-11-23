/** Windows npm.cmd may select its sibling Node instead of the reviewed runtime. */
import { existsSync } from 'node:fs'
import { basename, delimiter, dirname, join, resolve } from 'node:path'

export function npmCommand(args, environment = process.env) {
  const executableDirectory = dirname(process.execPath)
  const candidates = [
    ...(environment.npm_execpath && basename(environment.npm_execpath) === 'npm-cli.js' ? [environment.npm_execpath] : []),
    join(executableDirectory, 'node_modules/npm/bin/npm-cli.js'),
    resolve(executableDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ...(environment.PATH ?? environment.Path ?? '').split(delimiter).filter(Boolean).flatMap(directory => [
      join(directory, 'node_modules/npm/bin/npm-cli.js'), resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ]),
  ]
  const cli = candidates.find(existsSync)
  if (!cli) throw new Error('npm CLI is unavailable. Install a complete supported Node.js distribution for product builds.')
  const path = environment.PATH ?? environment.Path ?? ''
  const env = Object.fromEntries(Object.entries(environment).filter(([name]) => name.toLowerCase() !== 'path'))
  env.PATH = executableDirectory + delimiter + path
  return { command: process.execPath, args: [cli, ...args], env }
}
