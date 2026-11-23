import { migrate, pool } from './db'
await migrate()
console.log('数据表内核迁移完成')
await pool.end()
