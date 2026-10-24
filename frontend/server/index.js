// Vercel/本地 Node 运行版本，与 worker/src/index.js 保持同步（Cloudflare 版本）
import { Hono } from 'hono'
import { signToken, verifyToken, hashPassword, verifyPassword } from './auth.js'

const app = new Hono()

// ---------- 全局：CORS ----------
app.use('*', async (c, next) => {
  // CORS_ORIGIN 支持逗号分隔多个来源；* 表示全部放行（本地开发）
  const allowed = (c.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim().replace(/^[`'"]+|[`'"]+$/g, ''))
    .filter(Boolean)
  const requestOrigin = c.req.header('Origin') || ''
  const allowOrigin = allowed.includes('*')
    ? '*'
    : allowed.includes(requestOrigin)
      ? requestOrigin
      : allowed[0]
  c.header('Access-Control-Allow-Origin', allowOrigin)
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Authorization,Content-Type')
  c.header('Access-Control-Max-Age', '86400')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  return next()
})

app.onError((err, c) => {
  console.error('[worker error]', err)
  return c.json({ type: 'fail', message: '服务器内部错误' }, 500)
})

// ---------- 工具 ----------
const ok = (message, extra = {}) => ({ type: 'success', message, ...extra })
const fail = (message) => ({ type: 'fail', message })

async function readJson(c) {
  try {
    return await c.req.json()
  } catch {
    return {}
  }
}

function mapPackage(r) {
  return {
    id: r.id,
    pickupCode: r.pickup_code,
    sender: r.sender,
    courier: r.courier,
    receiver: r.receiver,
    station: r.station,
    pickedUp: r.picked_up === 1,
    createdAt: r.created_at,
  }
}

function mapUser(r) {
  return { username: r.username, role: r.role, identityCode: r.identity_code }
}

function mapNotification(r) {
  return { id: r.id, title: r.title, content: r.content, isRead: r.is_read === 1, createdAt: r.created_at }
}

// 站内通知：到站提醒 / 取件成功提醒
async function addNotification(db, username, title, content) {
  await db.prepare(
    'INSERT INTO notifications (username, title, content, is_read, created_at) VALUES (?, ?, ?, 0, ?)'
  )
    .bind(username, title, content, new Date().toISOString())
    .run()
}

async function usernameFromRequest(c) {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  try {
    return await verifyToken(auth.slice(7), c.env.AUTH_SECRET)
  } catch {
    return null
  }
}

async function adminOnly(c, next) {
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'), 401)
  const user = await c.env.DB.prepare('SELECT role FROM users WHERE username = ?')
    .bind(username)
    .first()
  if (!user || user.role !== 'admin') return c.json(fail('需要管理员权限'), 403)
  c.set('admin', username)
  return next()
}

async function stationExists(db, name) {
  const row = await db.prepare('SELECT 1 FROM stations WHERE name = ?').bind(name).first()
  return !!row
}

async function insertPackage(db, body, sender) {
  await db.prepare(
    `INSERT INTO packages (id, pickup_code, sender, courier, receiver, station, picked_up, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  )
    .bind(
      body.id,
      body.pickupCode,
      sender,
      body.courier,
      body.receiver,
      body.station,
      new Date().toISOString()
    )
    .run()
  await addNotification(
    db,
    body.receiver,
    '快递到站通知',
    `您的${body.courier}快递已到「${body.station}」，取件码 ${body.pickupCode}，请及时取件`
  )
}

function validatePackageBody(body) {
  for (const field of ['id', 'pickupCode', 'courier', 'receiver', 'station']) {
    if (!body[field] || !String(body[field]).trim()) return '快递信息不完整'
  }
  return null
}

// ---------- 认证 ----------
app.post('/api/login', async (c) => {
  const body = await readJson(c)
  const username = String(body.username ?? '').trim()
  if (!username) return c.json(fail('用户名或密码错误'))
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first()
  if (row && (await verifyPassword(String(body.password ?? ''), row.password))) {
    const token = await signToken(row.username, c.env.AUTH_SECRET)
    return c.json(ok('登录成功', { token }))
  }
  return c.json(fail('用户名或密码错误'))
})

// 身份码（出库码）自动生成：SFM + 10 位随机数字
function generateIdentityCode() {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map((n) => n % 10)
    .join('')
  return `SFM${digits}`
}

app.post('/api/register', async (c) => {
  const body = await readJson(c)
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  if (!username || !password) return c.json(fail('注册信息不完整'))
  if (password.length < 6) return c.json(fail('密码长度至少 6 位'))

  const dupUser = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()
  if (dupUser) return c.json(fail('用户名已存在'))

  // 身份码由服务端生成（客户端不再传入）；撞唯一索引时换一个重试
  let identityCode = ''
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateIdentityCode()
    try {
      await c.env.DB.prepare(
        'INSERT INTO users (username, password, role, identity_code) VALUES (?, ?, ?, ?)'
      )
        .bind(username, await hashPassword(password), 'user', candidate)
        .run()
      identityCode = candidate
      break
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e
    }
  }
  if (!identityCode) return c.json(fail('注册失败，请重试'))
  return c.json(ok('注册成功', { identityCode }))
})

app.get('/api/getSfmByToken', async (c) => {
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'))
  const row = await c.env.DB.prepare('SELECT identity_code FROM users WHERE username = ?')
    .bind(username)
    .first()
  if (!row) return c.json(fail('找不到身份码'))
  return c.json(ok('ok', { identityCode: row.identity_code }))
})

app.post('/api/change-password', async (c) => {
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'), 401)
  const { oldPassword, newPassword } = await readJson(c)
  if (!oldPassword || !newPassword) return c.json(fail('请填写原密码和新密码'))
  if (String(newPassword).length < 6) return c.json(fail('新密码长度至少 6 位'))
  const row = await c.env.DB.prepare('SELECT password FROM users WHERE username = ?')
    .bind(username)
    .first()
  if (!row || !(await verifyPassword(String(oldPassword), row.password))) {
    return c.json(fail('原密码错误'))
  }
  await c.env.DB.prepare('UPDATE users SET password = ? WHERE username = ?')
    .bind(await hashPassword(String(newPassword)), username)
    .run()
  return c.json(ok('密码修改成功，下次登录请使用新密码'))
})

// 公开：驿站名称列表（寄件表单下拉用，不含业务数据）
app.get('/api/stations', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT name FROM stations ORDER BY rowid').all()
  return c.json(results.map((r) => r.name))
})

// ---------- 包裹业务 ----------
// 收件包裹列表：身份取自 token，防止枚举他人取件码
app.get('/api/packages', async (c) => {
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'), 401)
  const { results } = await c.env.DB.prepare('SELECT * FROM packages WHERE receiver = ? ORDER BY rowid')
    .bind(username)
    .all()
  return c.json(results.map(mapPackage))
})

// 我寄出的包裹
app.get('/api/packages/sent', async (c) => {
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'), 401)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM packages WHERE sender = ? ORDER BY rowid DESC'
  )
    .bind(username)
    .all()
  return c.json(results.map(mapPackage))
})

app.post('/api/send', async (c) => {
  const sender = await usernameFromRequest(c)
  if (!sender) return c.json(fail('登录已过期，请重新登录'))
  const body = await readJson(c)
  const invalid = validatePackageBody(body)
  if (invalid) return c.json(fail(invalid))
  if (!(await stationExists(c.env.DB, body.station))) return c.json(fail('无效的驿站名称'))
  try {
    await insertPackage(c.env.DB, body, sender)
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return c.json(fail('快递单号已存在'))
    throw e
  }
  return c.json(ok('寄件成功'))
})

app.post('/api/sendadmin', adminOnly, async (c) => {
  const body = await readJson(c)
  const invalid = validatePackageBody(body)
  if (invalid) return c.json(fail(invalid))
  if (!(await stationExists(c.env.DB, body.station))) return c.json(fail('无效的驿站名称'))
  try {
    await insertPackage(c.env.DB, body, 'admin')
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return c.json(fail('快递单号已存在'))
    throw e
  }
  return c.json(ok('寄件成功'))
})

app.post('/api/pickup', async (c) => {
  // 身份取自 token：取件码只能由包裹主人本人使用
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'), 401)
  const { id, pickupCode } = await readJson(c)
  const pkg = await c.env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(id).first()
  if (
    pkg &&
    pkg.receiver === username &&
    pkg.picked_up === 0 &&
    pkg.pickup_code === String(pickupCode ?? '')
  ) {
    await c.env.DB.prepare('UPDATE packages SET picked_up = 1 WHERE id = ? AND picked_up = 0')
      .bind(id)
      .run()
    await addNotification(
      c.env.DB,
      username,
      '取件成功',
      `您在「${pkg.station}」的${pkg.courier}快递 ${pkg.id} 已完成取件`
    )
    return c.json(ok('取件成功'))
  }
  return c.json(fail('取件失败：单号、取件码不匹配或已被取走'))
})

app.post('/api/scan-pickup', async (c) => {
  const { identityCode, packageId } = await readJson(c)
  if (!identityCode || !packageId) return c.json(fail('参数不完整'))

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE identity_code = ?')
    .bind(identityCode)
    .first()
  if (!user) return c.json(fail('无效身份码'))

  const pkg = await c.env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(packageId).first()
  if (!pkg) return c.json(fail('快递不存在'))
  if (pkg.receiver !== user.username) return c.json(fail('请放置专用身份码'))
  if (pkg.picked_up === 1) return c.json(fail('快递已被取件'))

  await c.env.DB.prepare('UPDATE packages SET picked_up = 1 WHERE id = ?')
    .bind(packageId)
    .run()
  await addNotification(
    c.env.DB,
    user.username,
    '取件成功',
    `您在「${pkg.station}」的${pkg.courier}快递 ${pkg.id} 已扫码出库`
  )
  return c.json(ok('出库成功'))
})

// ---------- 站内通知 ----------
app.get('/api/notifications', async (c) => {
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'), 401)
  const [{ results }, unread] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM notifications WHERE username = ? ORDER BY id DESC LIMIT 50')
      .bind(username)
      .all(),
    c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE username = ? AND is_read = 0')
      .bind(username)
      .first(),
  ])
  return c.json({ list: results.map(mapNotification), unreadCount: unread.cnt })
})

app.post('/api/notifications/read-all', async (c) => {
  const username = await usernameFromRequest(c)
  if (!username) return c.json(fail('登录已过期，请重新登录'), 401)
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE username = ?')
    .bind(username)
    .run()
  return c.json(ok('已全部标记为已读'))
})

// ---------- 管理后台 ----------
app.use('/api/admin/*', adminOnly)

app.get('/api/admin/users', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY rowid').all()
  return c.json(results.map(mapUser))
})

app.delete('/api/admin/user/:username', async (c) => {
  const username = c.req.param('username')
  if (username === 'admin') return c.json(fail('用户删除失败'))
  const info = await c.env.DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run()
  return info.meta.changes > 0 ? c.json(ok('用户删除成功')) : c.json(fail('用户删除失败'))
})

app.get('/api/admin/stations', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.name AS name,
            (SELECT COUNT(*) FROM packages p WHERE p.station = s.name) AS packageCount
       FROM stations s ORDER BY s.rowid`
  ).all()
  return c.json(results)
})

app.post('/api/admin/station', async (c) => {
  const name = String((await readJson(c)).name ?? '').trim()
  if (!name) return c.json(fail('新增失败：名称不能为空或已存在'))
  try {
    await c.env.DB.prepare('INSERT INTO stations (name) VALUES (?)').bind(name).run()
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return c.json(fail('新增失败：名称不能为空或已存在'))
    throw e
  }
  return c.json(ok('驿站新增成功'))
})

app.put('/api/admin/station/:oldName', async (c) => {
  const oldName = c.req.param('oldName')
  const newName = String((await readJson(c)).name ?? '').trim()
  if (!newName) return c.json(fail('修改失败：名称不能为空、不存在或已存在'))
  const db = c.env.DB
  if (!(await stationExists(db, oldName))) return c.json(fail('修改失败：名称不能为空、不存在或已存在'))
  if (await stationExists(db, newName)) return c.json(fail('修改失败：名称不能为空、不存在或已存在'))

  await db.batch([
    db.prepare('UPDATE packages SET station = ? WHERE station = ?').bind(newName, oldName),
    db.prepare('INSERT INTO stations (name) VALUES (?)').bind(newName),
    db.prepare('DELETE FROM stations WHERE name = ?').bind(oldName),
  ])
  return c.json(ok('驿站修改成功'))
})

app.delete('/api/admin/station/:name', async (c) => {
  const name = c.req.param('name')
  if (!(await stationExists(c.env.DB, name))) {
    return c.json(fail('删除失败：驿站不存在或仍有快递未处理'))
  }
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM packages WHERE station = ?')
    .bind(name)
    .first()
  if (row.cnt > 0) return c.json(fail('删除失败：驿站不存在或仍有快递未处理'))
  await c.env.DB.prepare('DELETE FROM stations WHERE name = ?').bind(name).run()
  return c.json(ok('驿站删除成功'))
})

app.get('/api/admin/packages', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM packages ORDER BY rowid').all()
  return c.json(results.map(mapPackage))
})

app.patch('/api/admin/package/:id/status', async (c) => {
  const id = c.req.param('id')
  const isPickedUp = !!(await readJson(c)).isPickedUp
  const info = await c.env.DB.prepare('UPDATE packages SET picked_up = ? WHERE id = ?')
    .bind(isPickedUp ? 1 : 0, id)
    .run()
  return info.meta.changes > 0 ? c.json(ok('更新成功')) : c.json(fail('更新失败，找不到该快递'))
})

app.delete('/api/admin/package/:id', async (c) => {
  const id = c.req.param('id')
  const info = await c.env.DB.prepare('DELETE FROM packages WHERE id = ?').bind(id).run()
  return info.meta.changes > 0 ? c.json(ok('删除成功')) : c.json(fail('删除失败，找不到该快递'))
})

app.get('/api/admin/stats', async (c) => {
  const [{ results: users }, { results: pkgRows }] = await Promise.all([
    c.env.DB.prepare('SELECT username FROM users').all(),
    c.env.DB.prepare('SELECT * FROM packages').all(),
  ])
  const packages = pkgRows.map(mapPackage)

  const totalUsers = users.length
  const totalPackages = packages.length
  const pickedUp = packages.filter((p) => p.pickedUp).length

  const groupCount = (list, key) => {
    const m = new Map()
    for (const item of list) m.set(item[key], (m.get(item[key]) || 0) + 1)
    return [...m.entries()].map(([name, value]) => ({ name, value }))
  }

  // 近 7 天（UTC），created_at 为 ISO 文本，前 10 位即 YYYY-MM-DD
  const dailyStats = []
  const dayFmt = (d) => d.toISOString().slice(0, 10)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const dateStr = dayFmt(d)
    dailyStats.push({
      date: `${dateStr.slice(5, 7)}-${dateStr.slice(8, 10)}`,
      count: packages.filter((p) => p.createdAt && p.createdAt.slice(0, 10) === dateStr).length,
    })
  }

  return c.json({
    totalUsers,
    totalPackages,
    pickedUp,
    notPickedUp: totalPackages - pickedUp,
    income: pickedUp,
    courierStats: groupCount(packages, 'courier'),
    stationStats: groupCount(packages, 'station'),
    dailyStats,
  })
})

app.all('*', (c) => c.json(fail('not found'), 404))

export default app
