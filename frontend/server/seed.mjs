// 播种管理员：npm run db:seed（可用 ADMIN_PASSWORD 覆盖，默认 admin123 仅建议本地用）
// 对远程 Turso 播种时设置 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
import { createClient } from '@libsql/client'
import { hashPassword } from './auth.js'

const url = process.env.TURSO_DATABASE_URL || 'file:local.db'
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
const password = process.env.ADMIN_PASSWORD || 'admin123'

await client.execute({
  sql: `INSERT INTO users (username, password, role, identity_code) VALUES ('admin', ?, 'admin', 'ADMIN000000')
        ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = 'admin'`,
  args: [await hashPassword(password)],
})
console.log(`[seed] admin 密码已写入 ${url}`)
if (!process.env.ADMIN_PASSWORD) {
  console.log('[seed] 注意：未设置 ADMIN_PASSWORD，使用了默认密码 admin123（远程库请务必覆盖）')
}
