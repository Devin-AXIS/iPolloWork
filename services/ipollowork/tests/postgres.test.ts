/** PostgreSQL migration and concurrent wallet guarantees. */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/app.js";
import { importSqlite } from "../src/import-sqlite.js";
import { ledgerEntry, wallet, settleOrder } from "../src/domain.js";
import { testConfig } from "./database.js";

test("SQLite import preserves identities and ledger, rejects nonempty targets and leaves the source unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-import-test-"));
  const file = join(dir, "old.sqlite"),
    old = new DatabaseSync(file);
  old.exec(`CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT,emailVerified INTEGER,createdAt INTEGER,updatedAt INTEGER);
    CREATE TABLE ledger(id TEXT PRIMARY KEY,user_id TEXT,amount INTEGER,balance_after INTEGER,reference TEXT,reason TEXT,actor_id TEXT,created_at INTEGER);
    CREATE TABLE resources(id TEXT PRIMARY KEY,owner_id TEXT,enterprise_id TEXT,kind TEXT,visibility TEXT,title TEXT,description TEXT,version TEXT,storage_key TEXT,mime TEXT,bytes INTEGER,sha256 TEXT,created_at INTEGER);
    PRAGMA user_version=8`);
  old
    .prepare("INSERT INTO user VALUES(?,?,?,?,?,?)")
    .run(
      "existing-user",
      "Existing",
      "existing@example.test",
      1,
      Date.now(),
      Date.now(),
    );
  old
    .prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)")
    .run(
      "credit",
      "existing-user",
      1200,
      1200,
      "old-order",
      "Plan",
      null,
      Date.now(),
    );
  old
    .prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?)")
    .run(
      "debit",
      "existing-user",
      -200,
      1000,
      "old-call",
      "Usage",
      null,
      Date.now(),
    );
  old
    .prepare("INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      "legacy-file",
      "existing-user",
      null,
      "attachment",
      "private",
      "Old output",
      "",
      "1.0.0",
      "oss/legacy/output.txt",
      "text/plain",
      3,
      "old-digest",
      1,
    );
  old.close();
  const config = await testConfig({
    DATA_DIR: dir,
    SERVICE_ORIGIN: "http://localhost:4785",
  });
  const service = await createService(config);
  try {
    assert.deepEqual(await importSqlite(service.store, file, config), {
      user: 1,
      ledger: 2,
      resources: 1,
    });
    assert.equal(
      (
        await service.store.one(
          "SELECT used_bytes FROM storage_quotas WHERE owner_id=?",
          "existing-user",
        )
      )?.used_bytes,
      3,
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT expires_at FROM storage_objects WHERE id=?",
          "legacy-file",
        )
      )?.expires_at,
      null,
    );
    assert.equal((await wallet(service.store, "existing-user")).balance, 1000);
    assert.equal(
      (
        await service.store.one(
          'SELECT "emailVerified" FROM "user" WHERE id=?',
          "existing-user",
        )
      )?.emailVerified,
      true,
    );
    await assert.rejects(
      importSqlite(service.store, file, config),
      /must be empty/,
    );
    assert.equal((await wallet(service.store, "existing-user")).balance, 1000);
    const check = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(
        check.prepare("SELECT COUNT(*) AS n FROM ledger").get()?.n,
        2,
      );
    } finally {
      check.close();
    }
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("parallel debits cannot overspend or duplicate a wallet entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-wallet-test-"));
  const service = await createService(
    await testConfig({
      DATA_DIR: dir,
      SERVICE_ORIGIN: "http://localhost:4785",
    }),
  );
  try {
    const { user } = await service.auth.api.signUpEmail({
      body: {
        name: "Wallet",
        email: "wallet@example.test",
        password: "Wallet-test-password-2026",
      },
    });
    await service.store.transaction(() =>
      ledgerEntry(service.store, user.id, 100, "grant", "Grant"),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        service.store.transaction(() =>
          ledgerEntry(service.store, user.id, -30, "call-" + i, "Usage"),
        ),
      ),
    );
    const successful = results.filter(
      (result) => result.status === "fulfilled",
    ).length;
    assert(successful > 0 && successful <= 3);
    assert.equal(
      (await wallet(service.store, user.id)).balance,
      100 - successful * 30,
    );
    const recorded = await service.store.one(
      "SELECT reference FROM ledger WHERE amount<0 LIMIT 1",
    );
    await service.store.transaction(() =>
      ledgerEntry(
        service.store,
        user.id,
        -30,
        String(recorded!.reference),
        "Usage",
      ),
    );
    assert.equal(
      (await wallet(service.store, user.id)).balance,
      100 - successful * 30,
    );
    assert.equal(
      (
        await service.store.one(
          "SELECT SUM(amount) AS balance FROM ledger WHERE user_id=?",
          user.id,
        )
      )?.balance,
      100 - successful * 30,
    );
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent membership payments stack both terms when no credits are granted", async (context) => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-membership-test-"));
  const service = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const {user} = await service.auth.api.signUpEmail({body:{name:"Member",email:"member@example.test",password:"Membership-fixture-password"}});
    const start=Date.now();
    context.mock.timers.enable({apis:["Date"],now:start});
    await service.store.run("INSERT INTO plans(id,name,kind,amount,currency,points,days,enabled,created_at) VALUES('term','Term','membership',9900,'CNY',0,30,1,?)",start);
    for(const id of ['order-a','order-b']) await service.store.run("INSERT INTO orders(id,user_id,plan_id,provider,status,amount,currency,points,days,created_at) VALUES(?,?,'term','stripe','pending',9900,'CNY',0,30,?)",id,user.id,start);
    await Promise.all(['order-a','order-b'].map(id=>settleOrder(service.store,id,id,9900,'CNY')));
    const terms=await service.store.all("SELECT expires_at FROM entitlements WHERE user_id=? ORDER BY expires_at",user.id);
    assert.deepEqual(terms.map(term=>term.expires_at),[start+30*86400000,start+60*86400000]);
  } finally { context.mock.timers.reset(); await service.close(); await rm(dir,{recursive:true,force:true}); }
});
