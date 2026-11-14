import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export async function assertRestrictiveMode(path, expectedMode) {
  const actualMode = (await stat(path)).mode & 0o777;
  if (process.platform === 'win32') {
    assert.ok(actualMode > 0, `expected ${path} to exist with filesystem mode bits`);
    return;
  }
  assert.equal(actualMode, expectedMode);
}

export function toPosixPath(path) {
  return path.replaceAll('\\', '/');
}

export function assertPathMatches(path, pattern) {
  assert.match(toPosixPath(path), pattern);
}

export function assertPathInside(root, path) {
  const relativePath = relative(resolve(root), resolve(path));
  assert.equal(
    relativePath !== ''
      && relativePath !== '..'
      && !relativePath.startsWith('..\\')
      && !relativePath.startsWith('../')
      && !isAbsolute(relativePath),
    true,
    'staged path stays in the Session cwd',
  );
}

export async function symlinkOrSkip(t, target, path, type) {
  try {
    const { symlink } = await import('node:fs/promises');
    await symlink(target, path, type);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip(`symlink privileges are unavailable on this host: ${error.code}`);
      return false;
    }
    throw error;
  }
}
