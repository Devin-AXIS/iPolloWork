/** Each test fixture owns a PostgreSQL schema, including its Better Auth tables. */
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
    } finally {
      await db.end();
    }
    schemas.set(key, schema);
  }
  return loadConfig({
    ...env,
    DATABASE_URL: databaseUrl,
    DATABASE_SCHEMA: schema,
    DATABASE_POOL_SIZE: "4",
  });
}

after(async () => {
  const db = new Pool({ connectionString: databaseUrl });
  try {
    for (const schema of schemas.values())
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally {
    await db.end();
  }
});
