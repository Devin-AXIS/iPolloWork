import { createRequire } from "node:module";
const isBun = Boolean(process.versions.bun);
const driver = isBun ? await import("bun:sqlite") : createRequire(import.meta.url)("node:sqlite");
// OpsDatabase uses the shared exec/prepare/get/all/run/close subset. Strict bindings
// keep its existing bare named parameters compatible with the Node driver.
export const DatabaseSync = isBun ? class extends driver.Database {
  constructor(path) { super(path, { create: true, strict: true }); }
} : driver.DatabaseSync;
