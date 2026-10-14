import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqlitePool, decimalExpression, decimalInteger } from '../src/server/sqlite'

test('SQLite exact decimal comparisons and ordering retain all 14 integer and 4 fractional digits', async () => {
  const db = new SqlitePool(join(await mkdtemp(join(tmpdir(), 'onto-decimal-')), 'onto.sqlite'))
  try {
    await db.query('CREATE TABLE decimals(value DECIMAL_TEXT)')
    const values = ['99999999999999.9999', '-99999999999999.9999', '99999999999999.9998', '-0.0001', '0.0000', '1.1000']
    for (const value of values) await db.query('INSERT INTO decimals(value) VALUES($1)', [value])
    const expression = decimalExpression('value')
    assert.deepEqual((await db.query(`SELECT value FROM decimals ORDER BY ${expression}`)).rows.map(row => row.value),
      ['-99999999999999.9999', '-0.0001', '0.0000', '1.1000', '99999999999999.9998', '99999999999999.9999'])
    assert.equal((await db.query(`SELECT value FROM decimals WHERE ${expression}>$1`, [decimalInteger('99999999999999.9998')])).rows[0].value, '99999999999999.9999')
    assert.equal((await db.query("SELECT '$1' AS literal,$2 AS repeated,$2 AS second", ['unused', "'); DROP TABLE decimals; --"])).rows[0].literal, '$1')
    assert.equal((await db.query('SELECT count(*) AS count FROM decimals')).rows[0].count, 6)
  } finally { await db.end() }
})

test('SQLite serializes writers, rolls back failures, and restores values from the same file', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'onto-transaction-')), 'onto.sqlite')
  let db = new SqlitePool(path)
  await db.query('CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT)')
  const writer = await db.connect()
  await writer.query('BEGIN')
  await writer.query('INSERT INTO records VALUES($1,$2)', ['first', 'kept'])
  let completed = false
  const queued = db.query('INSERT INTO records VALUES($1,$2)', ['second', 'after commit']).then(() => { completed = true })
  await new Promise<void>(r => setImmediate(r))
  assert.equal(completed, false)
  await writer.query('COMMIT')
  writer.release()
  await queued
  const rejected = await db.connect()
  await rejected.query('BEGIN')
  await rejected.query('INSERT INTO records VALUES($1,$2)', ['rollback', 'discarded'])
  await rejected.query('ROLLBACK')
  rejected.release()
  await db.end()
  db = new SqlitePool(path)
  try { assert.deepEqual((await db.query('SELECT id FROM records ORDER BY id')).rows.map(row => row.id), ['first', 'second']) }
  finally { await db.end() }
})
