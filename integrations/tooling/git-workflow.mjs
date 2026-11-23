/** Shared, dependency-free Git guards; never changes history or stages user files. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const marker = '# ipollowork-git-workflow-v1'
const skill = '.agents/skills/github-sync-pr-flow/SKILL.md'

function git(cwd, args, optional = false) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (result.error) throw result.error
  if (result.status !== 0 && !optional) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  return result.status === 0 ? result.stdout.trim() : undefined
}

function protectedBranches(cwd) {
  const head = git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], true)
  return new Set(['main', 'master', ...(head ? [head.replace('refs/remotes/origin/', '')] : [])])
}

function mainRef(cwd) {
  return git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], true) ?? 'refs/remotes/origin/main'
}

function retiredLefthook(path, cwd) {
  return readFileSync(path, 'utf8').includes('call_lefthook') &&
    !['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml', 'lefthook-local.yml', 'lefthook-local.yaml'].some(file => existsSync(join(cwd, file)))
}

export function checkCommit(cwd = root) {
  const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)
  if (!branch || protectedBranches(cwd).has(branch)) throw new Error('Commit on your personal branch, not main/master or a detached HEAD.')
  if (git(cwd, ['ls-files', '--unmerged'])) throw new Error('Resolve and stage all merge conflicts before committing.')
  git(cwd, ['diff', '--cached', '--check'])
}

/** Fetch main before admission; reject direct main pushes and history rewrites. */
export function checkPush(input, cwd = root) {
  const protectedNames = protectedBranches(cwd)
  const updates = input.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const fields = line.split(/\s+/)
    if (fields.length !== 4 || !/^[\da-f]{40}(?:[\da-f]{24})?$/.test(fields[1]) || !/^[\da-f]{40}(?:[\da-f]{24})?$/.test(fields[3])) throw new Error('Invalid Git pre-push input.')
    const [localRef, localOid, remoteRef, remoteOid] = fields
    return { localRef, localOid, remoteRef, remoteOid }
  })
  const branchUpdates = updates.filter(item => item.remoteRef.startsWith('refs/heads/'))
  for (const update of branchUpdates) {
    const remoteBranch = update.remoteRef.slice('refs/heads/'.length)
    if (protectedNames.has(remoteBranch)) throw new Error(`Direct push/deletion of ${remoteBranch} is blocked; use a reviewed PR.`)
  }
  const active = branchUpdates.filter(item => !/^0+$/.test(item.localOid))
  if (!active.length) return
  const current = git(cwd, ['symbolic-ref', '--quiet', 'HEAD'], true)
  for (const update of active) {
    if (update.localRef !== current) throw new Error('Push only the current personal branch; inspect other branch updates separately.')
    if (!/^0+$/.test(update.remoteOid) && git(cwd, ['merge-base', '--is-ancestor', update.remoteOid, update.localOid], true) === undefined) {
      throw new Error('Non-fast-forward push blocked. Fetch the target branch and merge; do not force-push shared history.')
    }
  }
  const ref = mainRef(cwd)
  const branch = ref.replace('refs/remotes/origin/', '')
  git(cwd, ['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:${ref}`])
  for (const update of active) {
    if (git(cwd, ['merge-base', '--is-ancestor', ref, update.localOid], true) === undefined) throw new Error(`Remote ${branch} has changes missing from your push. Preserve local work, merge origin/${branch}, validate, and retry.`)
  }
}

/** Install only in this repository, keeping custom hooks as chained originals. */
export function installGitHooks(cwd = root, env = process.env) {
  if (env.CI) return
  if (git(cwd, ['rev-parse', '--is-inside-work-tree'], true) !== 'true') return
  const custom = git(cwd, ['config', '--get', 'core.hooksPath'], true)
  if (custom) throw new Error('core.hooksPath is already configured. Keep it and chain check / pre-push from integrations/tooling/git-workflow.mjs in that hook manager; see CONTRIBUTING.md.')
  const hooks = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'hooks']))
  mkdirSync(hooks, { recursive: true })
  for (const name of ['pre-commit', 'pre-merge-commit', 'pre-push']) {
    const path = join(hooks, name)
    const original = path + '.ipollowork-original'
    if (existsSync(path) && !readFileSync(path, 'utf8').includes(marker)) {
      if (existsSync(original)) throw new Error(`${name} was changed after installation; reconcile it with its .ipollowork-original backup before reinstalling.`)
      renameSync(path, original)
    }
    writeFileSync(path, `#!/bin/sh\n${marker}\nexec node "$(git rev-parse --show-toplevel)/integrations/tooling/git-workflow.mjs" hook ${name} "$0" "$@"\n`, { mode: 0o755 })
  }
  // Old generated message/rebase hooks would otherwise still invoke a removed
  // Lefthook configuration. Keep their files; leave non-Lefthook/LFS hooks alone.
  for (const name of ['prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'post-rewrite']) {
    const path = join(hooks, name)
    if (!existsSync(path) || !retiredLefthook(path, cwd)) continue
    if (existsSync(path + '.ipollowork-original')) throw new Error(`Preserve and reconcile the existing ${name}.ipollowork-original before reinstalling.`)
    renameSync(path, path + '.ipollowork-original')
  }
  console.log(`Git workflow hooks installed; agent instructions: ${skill}`)
}

export function checkPullRequest(event, cwd = root) {
  if (!event.pull_request) return
  const { base, head } = event.pull_request
  for (const sha of [base.sha, head.sha]) if (!/^[\da-f]{40}(?:[\da-f]{24})?$/.test(sha)) throw new Error('Invalid PR revision.')
  if (git(cwd, ['merge-base', '--is-ancestor', base.sha, head.sha], true) === undefined) throw new Error(`Merge the PR base (${base.ref}) into the personal branch and rerun its checks.`)
  git(cwd, ['diff', '--check', `${base.sha}...${head.sha}`])
  for (const path of [skill, 'AGENTS.md', 'CLAUDE.md', 'integrations/tooling/git-workflow.mjs']) {
    if (!git(cwd, ['show', `${head.sha}:${path}`], true)) throw new Error(`PR is missing the shared Git workflow file: ${path}`)
  }
}

function runHook(name, path, args, cwd) {
  console.error(`iPolloWork Git workflow: ${skill}`)
  const input = name === 'pre-push' ? readFileSync(0, 'utf8') : undefined
  if (name === 'pre-push') checkPush(input, cwd)
  else {
    checkCommit(cwd)
    const verify = spawnSync(process.execPath, [join(cwd, 'integrations/tooling/verify.mjs')], { cwd, stdio: 'inherit', windowsHide: true })
    if (verify.error) throw verify.error
    if (verify.status !== 0) throw new Error('Pinned DSH verification failed; run npm run setup and check:upstream.')
  }
  const original = resolve(cwd, path) + '.ipollowork-original'
  if (!existsSync(original)) return
  // The removed product Lefthook config contained only whitespace + upstream
  // checks, now performed above. Other hooks, including Git LFS, still run.
  if (retiredLefthook(original, cwd)) return
  const result = spawnSync('sh', [original, ...args], { cwd, windowsHide: true,
    ...(input === undefined ? { stdio: 'inherit' } : { input, stdio: ['pipe', 'inherit', 'inherit'] }) })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Existing ${name} hook failed (${result.status}). Its original file is preserved.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    const cwd = process.cwd()
    if (command === 'install') installGitHooks(cwd)
    else if (command === 'check') checkCommit(cwd)
    else if (command === 'pre-push') checkPush(readFileSync(0, 'utf8'), cwd)
    else if (command === 'hook') runHook(args[0], args[1], args.slice(2), cwd)
    else if (command === 'ci') checkPullRequest(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), cwd)
    else throw new Error('Expected install, check, pre-push, hook, or ci.')
  } catch (error) {
    console.error(`Git workflow: ${error.message}\nRead ${skill}`)
    process.exitCode = 1
  }
}
