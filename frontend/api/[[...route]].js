// Vercel Serverless Function 入口：所有 /api/* 请求都进入同一个 Hono 应用
// （vercel.json 里对非 /api 路径做 SPA 回退到 index.html）
//
// 注意：默认导出只声明一个参数 —— Vercel 依据参数个数判定调用方式，
// 单参数才会按 Web 标准（传入 Request、返回 Response）调用；
// 下面同时保留了传统 (req, res) 签名的转换兜底，两种调用方式都能工作。
import app from '../server/index.js'
import { getDb } from '../server/db.js'

export const runtime = 'nodejs'

function makeEnv() {
  return {
    DB: getDb(),
    AUTH_SECRET: process.env.AUTH_SECRET,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  }
}

function missingSecretResponse() {
  return new Response(
    JSON.stringify({ type: 'fail', message: 'AUTH_SECRET 未配置：请在 Vercel 环境变量中设置后重新部署' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  )
}

// 传统 Node IncomingMessage -> Web Request
async function toWebRequest(req) {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers || {})) {
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
  }
  const host = req.headers?.host || req.headers?.['x-forwarded-host'] || 'localhost'
  const method = req.method || 'GET'
  let body
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (chunks.length) body = Buffer.concat(chunks)
  }
  return new Request(`https://${host}${req.url || '/'}`, { method, headers, body })
}

// 把 Web Response 写回传统 ServerResponse
async function sendToNodeRes(response, res) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}

export default async function handler(request, legacyRes) {
  if (!process.env.AUTH_SECRET) return missingSecretResponse()

  // Web 标准调用：request 是 Request 实例
  if (request instanceof Request) {
    return app.fetch(request, makeEnv())
  }

  // 传统调用兜底：request 是 IncomingMessage，legacyRes 是 ServerResponse
  const webRequest = await toWebRequest(request)
  const response = await app.fetch(webRequest, makeEnv())
  if (legacyRes && typeof legacyRes.end === 'function') {
    await sendToNodeRes(response, legacyRes)
    return
  }
  return response
}
