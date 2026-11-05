import { createRequire } from 'node:module';
const isBun = Boolean(process.versions.bun);
const driver = createRequire(import.meta.url)(isBun ? 'bun:sqlite' : 'node:sqlite');

// Build-time alias shared by closed plugin bundles. Customers use the host's
// SQLite runtime; no native addon, package manager, or database server is needed.
export const DatabaseSync = isBun ? class extends driver.Database {
  constructor(path) { super(path, { create: true, strict: true }); }
  prepare(sql) {
    const statement = super.prepare(sql);
    statement.setReadBigInts = enabled => statement.safeIntegers(enabled);
    // Bun columnTypes steps the query before parameters are bound (and can execute DML).
    // Column names are metadata-only; the owning adapter decodes its known domain types.
    statement.columns = () => statement.columnNames.map(name => ({ name, type: null }));
    return statement;
  }
} : driver.DatabaseSync;
