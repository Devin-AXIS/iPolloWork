/** Each test fixture owns a PostgreSQL schema, including its Better Auth tables, and a sibling app data schema. */
import { after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadConfig, type Config } from "../src/config.js";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://127.0.0.1:5432/ipollowork_test";
const schemas = new Map<string, string>();

export async function testConfig(env: NodeJS.ProcessEnv): Promise<Config> {
  const key = env.DATA_DIR!;
  let schema = schemas.get(key);
  if (!schema) {
    schema = "test_" + randomUUID().replace(/-/g, "");
    const db = new Pool({ connectionString: databaseUrl });
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await db.query(`CREATE SCHEMA ${schema}_data`);
    } finally {
      await db.end();
    }
    schemas.set(key, schema);
  }
  return loadConfig({
    APP_DATA_DATABASE_URL: databaseUrl,
    APP_DATA_DATABASE_SCHEMA: schema + "_data",
    APP_DATA_POOL_SIZE: "4",
    ...env,
    DATABASE_URL: databaseUrl,
    DATABASE_SCHEMA: schema,
    DATABASE_POOL_SIZE: "4",
  });
}

after(async () => {
  const db = new Pool({ connectionString: databaseUrl });
  try {
    for (const schema of schemas.values()) {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      await db.query(`DROP SCHEMA IF EXISTS ${schema}_data CASCADE`);
    }
  } finally {
    await db.end();
  }
});
