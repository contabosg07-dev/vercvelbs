// 建表脚本：npm run db:migrate
// 默认写本地 ./local.db；对远程 Turso 执行时设置 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL || 'file:local.db'
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
// schema 均为简单 DDL：去掉 -- 注释行后按分号切分逐条执行
const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

for (const s of statements) await client.execute(s)
console.log(`[migrate] 已执行 ${statements.length} 条语句 -> ${url}`)
