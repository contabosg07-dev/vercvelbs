// 本地开发 API：npm run dev:api（默认 http://localhost:8787，vite 代理 /api 指向这里）
// 默认使用本地 SQLite 文件 ./local.db；设置 TURSO_DATABASE_URL/TURSO_AUTH_TOKEN 可连远程 Turso
import { serve } from '@hono/node-server'
import app from './index.js'
import { getDb } from './db.js'

const env = {
  DB: getDb(),
  AUTH_SECRET: process.env.AUTH_SECRET || 'local-dev-secret',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
}

serve({ fetch: (req) => app.fetch(req, env), port: 8787 }, (info) => {
  console.log(`[dev] API 已启动: http://localhost:${info.port}`)
})
