import { loadConfig } from '../config.js';
import { createBackup } from '../operator-backup.js';
import { loadEnvironment } from './environment.js';

loadEnvironment();
if (!process.argv[2]) throw new Error('Usage: npm run backup -- /absolute/new/directory. Stop all service writers first.');
const target = await createBackup(loadConfig(), process.argv[2]);
console.log('Backup completed: ' + target + '. Includes configured databases, DATA_DIR and the effective authentication key. OSS must be backed up separately.');
