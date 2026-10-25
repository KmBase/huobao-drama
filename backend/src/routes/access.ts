/**
 * 访问密码路由 — 登录 / 登出 / 状态查询
 * 未配置密码时 status.required = false，其余接口不做鉴权（由全局中间件决定）
 */
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import {
  ACCESS_COOKIE, hasAccessPassword, verifyAccessPassword, currentToken, isTokenValid,
  setAccessPassword, loginBackoffMs, recordLoginFail, clearLoginFails,
} from '../services/access-auth.js'
import { success, badRequest } from '../utils/response.js'

const app = new Hono()

function clientIp(c: any): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

const COOKIE_OPTS = { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 180 * 24 * 3600 } as const

// GET /status — 前端锁屏用：是否需要密码、当前是否已通过
app.get('/status', async (c) => {
  const required = await hasAccessPassword()
  const authed = required
    ? await isTokenValid(getCookie(c, ACCESS_COOKIE) ?? c.req.header('x-access-token'))
    : true
  return success(c, { required, authed })
})

// POST /login — body: { password }；成功种 httpOnly cookie（同源 fetch 自动携带），
// 同时返回 token（供需要显式携带的场景，如外链下载 ?token=）
app.post('/login', async (c) => {
  const ip = clientIp(c)
  const backoff = loginBackoffMs(ip)
  if (backoff > 0) {
    return badRequest(c, `失败次数过多，请 ${Math.ceil(backoff / 1000)} 秒后再试`)
  }
  const body = await c.req.json().catch(() => null)
  if (!(await hasAccessPassword())) return badRequest(c, '未启用访问密码')
  if (!(await verifyAccessPassword(body?.password))) {
    recordLoginFail(ip)
    return badRequest(c, '密码错误')
  }
  clearLoginFails(ip)
  const token = await currentToken()
  setCookie(c, ACCESS_COOKIE, token!, COOKIE_OPTS)
  return success(c, { token })
})

// POST /logout — 清除本机登录态（改密后旧令牌也会自动失效）
app.post('/logout', (c) => {
  deleteCookie(c, ACCESS_COOKIE, { path: '/' })
  return success(c, { ok: true })
})

// PUT /password — 修改/清除访问密码（body: { password }，空串清除）。本身要求已通过鉴权
app.put('/password', async (c) => {
  if (await hasAccessPassword()) {
    const authed = await isTokenValid(getCookie(c, ACCESS_COOKIE) ?? c.req.header('x-access-token'))
    if (!authed) return badRequest(c, '请先输入当前密码登录')
  }
  const body = await c.req.json().catch(() => null)
  try {
    await setAccessPassword(body?.password)
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
  // 密码变更后旧令牌全部失效：立即给当前会话种上新 cookie，避免把自己锁在页面外
  const token = await currentToken()
  if (token) setCookie(c, ACCESS_COOKIE, token, COOKIE_OPTS)
  else deleteCookie(c, ACCESS_COOKIE, { path: '/' })
  return success(c, { token })
})

export default app
