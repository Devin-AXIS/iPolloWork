import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { importSqlite } from '../import-sqlite.js';
import { openOperatorDatabase } from './database.js';
import { loadEnvironment } from './environment.js';

loadEnvironment();
if (!process.argv[2]) throw new Error('Usage: npm run import:sqlite -- /absolute/path/work.sqlite');
const config = loadConfig();
const { store } = await openOperatorDatabase(config);
try {
  const counts = await importSqlite(store, resolve(process.argv[2]), config);
  console.log(JSON.stringify({ imported: counts, verified: true }));
} finally {
  await store.close();
}
