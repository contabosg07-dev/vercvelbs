// Vercel Serverless Function 入口：所有 /api/* 请求都进入同一个 Hono 应用
// （vercel.json 里对非 /api 路径做 SPA 回退到 index.html）
import app from '../server/index.js'
import { getDb } from '../server/db.js'

export const runtime = 'nodejs'

export default async function handler(request, context) {
  if (!process.env.AUTH_SECRET) {
    return new Response(JSON.stringify({ type: 'fail', message: 'AUTH_SECRET 未配置：请在 Vercel 环境变量中设置后重新部署' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const env = {
    DB: getDb(),
    AUTH_SECRET: process.env.AUTH_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  }
  const executionCtx = context?.waitUntil ? { waitUntil: context.waitUntil.bind(context) } : undefined
  return app.fetch(request, env, executionCtx)
}
