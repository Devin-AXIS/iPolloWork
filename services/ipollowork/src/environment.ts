import { existsSync } from 'node:fs';

/** Process variables override a selected private dotenv; all entrypoints use the same loader. */
export function loadEnvironment(): void {
  const selected = process.env.IPOLLO_CONFIG_FILE;
  const path = selected || '.env';
  if (!selected && !existsSync(path)) return;
  try { process.loadEnvFile(path); }
  catch { throw new Error('Cannot read the service configuration file. Check IPOLLO_CONFIG_FILE and file permissions.'); }
}
