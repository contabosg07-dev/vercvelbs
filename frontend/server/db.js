// Turso(libSQL) 客户端 + D1 兼容垫片
// 业务代码沿用 Cloudflare D1 的 prepare().bind().first()/all()/run()/batch() 写法，
// 这里把它适配到 @libsql/client，使 worker 版与 Vercel 版业务代码保持一致。
import { createClient } from '@libsql/client'

let shim = null

export function getDb(env = process.env) {
  if (shim) return shim
  const url = env.TURSO_DATABASE_URL || `file:${env.LOCAL_DB_FILE || 'local.db'}`
  const client = createClient({ url, authToken: env.TURSO_AUTH_TOKEN })
  shim = createD1Shim(client)
  return shim
}

export function createD1Shim(client) {
  const makeStmt = (sql, params = []) => ({
    sql,
    params,
    bind(...args) {
      return makeStmt(sql, args)
    },
    async first() {
      const rs = await client.execute({ sql, args: params })
      return rs.rows[0] ?? null
    },
    async all() {
      const rs = await client.execute({ sql, args: params })
      return { results: rs.rows }
    },
    async run() {
      const rs = await client.execute({ sql, args: params })
      return { meta: { changes: rs.rowsAffected } }
    },
  })

  return {
    prepare(sql) {
      return makeStmt(sql)
    },
    // D1 的 batch 是事务性的：优先走 libSQL 交互式事务，环境不支持时退化为顺序执行
    async batch(statements) {
      try {
        const tx = await client.transaction()
        const results = []
        for (const st of statements) {
          const rs = await tx.execute({ sql: st.sql, args: st.params })
          results.push({ meta: { changes: rs.rowsAffected } })
        }
        await tx.commit()
        return results
      } catch (e) {
        if (!/transaction/i.test(String(e?.message))) throw e
        const results = []
        for (const st of statements) results.push(await st.run())
        return results
      }
    },
  }
}
