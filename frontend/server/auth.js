// Vercel/本地 Node 运行版本，与 worker/src/auth.js 保持同步（Cloudflare 版本）
// 无状态鉴权工具：
// - token：base64url(payload).base64url(hmacSHA256)，默认 7 天有效
// - 密码：PBKDF2-SHA256 / 100000 轮，格式 pbkdf2$100000$saltB64url$hashB64url
// 同时兼容 Workers 运行时与 Node 18+（seed.mjs 复用）

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const PBKDF2_ITERATIONS = 100000

function b64urlEncode(buf) {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str) {
  const pad = 4 - (str.length % 4)
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + (pad === 4 ? '' : '='.repeat(pad))
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function signToken(username, secret, ttlMs = TTL_MS) {
  const payload = { sub: username, iat: Date.now(), exp: Date.now() + ttlMs }
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)))
  const sig = b64urlEncode(await hmac(body, secret))
  return `${body}.${sig}`
}

export async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)))
  } catch {
    return null
  }
  const expected = await hmac(body, secret)
  if (!timingSafeEqual(expected, b64urlDecode(sig))) return null
  if (!payload.exp || payload.exp < Date.now()) return null
  return payload.sub || null
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2$')) return false
  const [, iterStr, saltB64, hashB64] = stored.split('$')
  const iterations = Number(iterStr)
  const salt = b64urlDecode(saltB64)
  const expected = b64urlDecode(hashB64)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    expected.length * 8
  )
  return timingSafeEqual(expected, new Uint8Array(bits))
}
