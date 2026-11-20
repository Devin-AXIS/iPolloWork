import { loadConfig } from '../config.js';
import { Store } from '../database.js';
import { migrateAppData } from '../app-data.js';
import { openOperatorDatabase } from './database.js';
import { loadEnvironment } from './environment.js';

loadEnvironment();
const config = loadConfig();
const { store } = await openOperatorDatabase(config);
try {
  if (config.appData) {
    const data = new Store(config.appData);
    try { await migrateAppData(data); }
    finally { await data.close(); }
  }
  console.log('Account and configured app-data migrations completed.');
} finally {
  await store.close();
}
