import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCommit, checkPush, checkPullRequest, installGitHooks } from '../git-workflow.mjs'

const source = fileURLToPath(new URL('../../..', import.meta.url))
const skill = '.agents/skills/github-sync-pr-flow/SKILL.md'
const script = 'integrations/tooling/git-workflow.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ipw-git-workflow-'))
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.match(directory.slice(dirname(directory).length + 1), /^ipw-git-workflow-/)
    rmSync(directory, { recursive: true, force: true })
  })
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(directory, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1' }
  const repo = join(directory, 'working copy'), remote = join(directory, 'origin.git')
  mkdirSync(repo)
  function git(args, cwd = repo, success = true) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 30_000, windowsHide: true })
    if (success) assert.equal(result.status, 0, result.stderr || result.error?.message)
    return result
  }
  const write = (path, value) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), value) }
  git(['init', '--bare', '--initial-branch=main', remote])
  git(['init', '--initial-branch=main'])
  git(['config', 'user.name', 'Git workflow fixture'])
  git(['config', 'user.email', 'fixture@example.test'])
  for (const path of [skill, script, 'AGENTS.md', 'CLAUDE.md']) write(path, readFileSync(join(source, path)))
  write('integrations/tooling/verify.mjs', '// Disposable fixture: no downloaded DSH required.\n')
  write('base.txt', 'base\n')
  git(['add', '.'])
  git(['commit', '-m', 'Seed fixture'])
  const base = git(['rev-parse', 'HEAD']).stdout.trim()
  git(['remote', 'add', 'origin', remote])
  git(['push', '-u', 'origin', 'main'])
  git(['remote', 'set-head', 'origin', 'main'])
  return { repo, remote, directory, git, write, base, install: () => installGitHooks(repo, {}) }
}

test('installed hooks reject main and whitespace, preserve custom checks and install idempotently', t => {
  const f = fixture(t)
  const original = '#!/bin/sh\nprintf original > original-check.txt\n'
  f.write('.git/hooks/pre-commit', original)
  const retired = '#!/bin/sh\ncall_lefthook prepare-commit-msg\nexit 42\n'
  f.write('.git/hooks/prepare-commit-msg', retired)
  f.install()
  f.install()
  assert.equal(readFileSync(join(f.repo, '.git/hooks/pre-commit.ipollowork-original'), 'utf8'), original)
  assert.equal(readFileSync(join(f.repo, '.git/hooks/prepare-commit-msg.ipollowork-original'), 'utf8'), retired)
  assert.equal(existsSync(join(f.repo, '.git/hooks/prepare-commit-msg')), false)
  f.write('change.txt', 'change\n')
  f.git(['add', 'change.txt'])
  assert.match(f.git(['commit', '-m', 'Blocked on main'], f.repo, false).stderr, /personal branch/)
  f.git(['switch', '-c', 'alice'])
  f.write('change.txt', 'bad whitespace  \n')
  f.git(['add', 'change.txt'])
  assert.throws(() => checkCommit(f.repo), /trailing whitespace/)
  f.write('change.txt', 'safe change\n')
  f.git(['add', 'change.txt'])
  f.git(['commit', '-m', 'Keep custom checks'])
  assert.equal(readFileSync(join(f.repo, 'original-check.txt'), 'utf8'), 'original')
})

test('pre-push sync guard detects actual remote changes and preserves previous hook stdin and arguments', t => {
  const f = fixture(t)
  f.write('.git/hooks/pre-push', '#!/bin/sh\nprintf "%s\\n" "$@" > previous-args.txt\ncat > previous-input.txt\n')
  f.install()
  f.git(['switch', '-c', 'alice'])
  f.write('alice.txt', 'personal work\n')
  f.git(['add', 'alice.txt'])
  f.git(['commit', '-m', 'Personal work'])
  // A second developer advances main without touching the guarded working copy.
  const peer = join(f.directory, 'peer')
  f.git(['clone', f.remote, peer])
  f.git(['config', 'user.name', 'Peer fixture'], peer)
  f.git(['config', 'user.email', 'peer@example.test'], peer)
  writeFileSync(join(peer, 'peer.txt'), 'peer work\n')
  f.git(['add', 'peer.txt'], peer)
  f.git(['commit', '-m', 'Advance main'], peer)
  f.git(['push', 'origin', 'main'], peer)
  const blocked = f.git(['push', 'origin', 'alice'], f.repo, false)
  assert.notEqual(blocked.status, 0)
  assert.match(blocked.stderr, /changes missing/)
  assert.equal(existsSync(join(f.repo, 'previous-input.txt')), false)
  f.git(['merge', 'origin/main', '--no-edit'])
  f.git(['push', '-u', 'origin', 'alice'])
  assert.match(readFileSync(join(f.repo, 'previous-input.txt'), 'utf8'), /^refs\/heads\/alice [\da-f]+ refs\/heads\/alice 0+\r?\n$/)
  assert.equal(readFileSync(join(f.repo, 'previous-args.txt'), 'utf8').split(/\r?\n/)[0], 'origin')
})

test('guard rejects protected-branch deletion, force updates, detached commits and unresolved merge conflicts', t => {
  const f = fixture(t)
  const zeros = '0'.repeat(40)
  assert.throws(() => checkPush(`(delete) ${zeros} refs/heads/main ${f.base}\n`, f.repo), /Direct push\/deletion/)
  f.git(['switch', '-c', 'alice'])
  f.write('base.txt', 'alice\n')
  f.git(['add', 'base.txt'])
  f.git(['commit', '-m', 'Alice edit'])
  const alice = f.git(['rev-parse', 'HEAD']).stdout.trim()
  assert.throws(() => checkPush(`refs/heads/alice ${f.base} refs/heads/alice ${alice}\n`, f.repo), /Non-fast-forward/)
  f.git(['switch', 'main'])
  f.write('base.txt', 'main\n')
  f.git(['add', 'base.txt'])
  f.git(['commit', '-m', 'Main fixture edit'])
  f.git(['switch', 'alice'])
  assert.notEqual(f.git(['merge', 'main', '--no-edit'], f.repo, false).status, 0)
  assert.throws(() => checkCommit(f.repo), /merge conflicts/)
  f.git(['merge', '--abort'])
  f.git(['switch', '--detach'])
  assert.throws(() => checkCommit(f.repo), /detached HEAD/)
})

test('CI checks the PR head rather than the synthetic merge and detects missing policy files', t => {
  const f = fixture(t)
  f.git(['switch', '-c', 'alice'])
  f.write('alice.txt', 'work\n')
  f.git(['add', 'alice.txt'])
  f.git(['commit', '-m', 'Work'])
  const head = f.git(['rev-parse', 'HEAD']).stdout.trim()
  checkPullRequest({ pull_request: { base: { ref: 'main', sha: f.base }, head: { sha: head } } }, f.repo)
  f.git(['rm', skill])
  f.git(['commit', '-m', 'Remove shared policy fixture'])
  const removed = f.git(['rev-parse', 'HEAD']).stdout.trim()
  assert.throws(() => checkPullRequest({ pull_request: { base: { ref: 'main', sha: f.base }, head: { sha: removed } } }, f.repo), /missing the shared/)
  assert.throws(() => checkPullRequest({ pull_request: { base: { ref: 'main', sha: head }, head: { sha: f.base } } }, f.repo), /Merge the PR base/)
})

test('installation preserves custom hook managers and skips CI without touching hooks', t => {
  const f = fixture(t)
  f.git(['config', 'core.hooksPath', 'custom-hooks'])
  assert.throws(() => f.install(), /core.hooksPath/)
  installGitHooks(f.repo, { CI: 'true' })
  assert.equal(existsSync(join(f.repo, '.git/hooks/pre-commit')), false)
  assert.equal(f.git(['config', '--get', 'core.hooksPath']).stdout.trim(), 'custom-hooks')
})
