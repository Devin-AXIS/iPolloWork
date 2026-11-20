import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Config } from './config.js';

const exec = promisify(execFile);

/** Works on Windows as well as Linux and resolves existing parent symlinks. */
export async function backupTarget(dataDir: string, destination: string): Promise<string> {
  const target = resolve(destination);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const canonicalTarget = resolve(await realpath(dirname(target)), basename(target));
  const child = relative(await realpath(dataDir), canonicalTarget);
  if (!child || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep)))
    throw new Error('Backups must be outside DATA_DIR.');
  return canonicalTarget;
}

async function dump(url: string, schema: string, file: string): Promise<void> {
  const database = new URL(url);
  const env = { ...process.env, PGHOST: database.hostname, PGPORT: database.port || '5432',
    PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)), PGCONNECT_TIMEOUT: '10' };
  for (const [option, variable] of Object.entries({ sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', options: 'PGOPTIONS' })) {
    const value = database.searchParams.get(option);
    if (value) Reflect.set(env, variable, value);
  }
  try {
    await exec('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--schema=' + schema, '--file=' + file], { env });
    await chmod(file, 0o600);
  } catch {
    throw new Error('PostgreSQL backup failed. Check connectivity, schema access and the pg_dump major version. No complete backup was published.');
  }
}

/** Publish only after both databases, private files and the effective key were copied. */
export async function createBackup(config: Config, destination: string): Promise<string> {
  const target = await backupTarget(config.dataDir, destination);
  if (await lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }))
    throw new Error('Backup destination already exists. Choose a new directory.');
  const staging = await mkdtemp(resolve(dirname(target), '.ipw-backup-'));
  try {
    await chmod(staging, 0o700);
    await dump(config.databaseUrl, config.databaseSchema, resolve(staging, 'work.dump'));
    if (config.appData) await dump(config.appData.databaseUrl, config.appData.databaseSchema, resolve(staging, 'app-data.dump'));
    const data = resolve(staging, 'data');
    await mkdir(data, { mode: 0o700 });
    for (const name of await readdir(config.dataDir)) {
      if (name.startsWith('work.sqlite') || name === 'auth.secret') continue;
      await cp(resolve(config.dataDir, name), resolve(data, name), { recursive: true, errorOnExist: true, force: false });
    }
    // AUTH_SECRET can override a stale DATA_DIR file. Save the key actually in use.
    await writeFile(resolve(data, 'auth.secret'), config.secret, { mode: 0o600, flag: 'wx' });
    await writeFile(resolve(staging, 'manifest.json'), JSON.stringify({ format: 1, completedAt: new Date().toISOString(),
      account: { file: 'work.dump', schema: config.databaseSchema },
      appData: config.appData ? { file: 'app-data.dump', schema: config.appData.databaseSchema } : null,
      data: 'data', authSecret: 'data/auth.secret', ossIncluded: false,
      consistency: 'Stop all service writers before taking a paired database and file backup.',
    }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(staging, target);
    return target;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
