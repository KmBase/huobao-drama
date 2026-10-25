/**
 * 访问密码 — 服务器/内网穿透远程访问的简易口令保护
 * - 密码只存 sha256 摘要（app_settings: access_password_hash），未配置 = 不启用鉴权
 * - 访问令牌 = sha256('huobao-access:' + 密码摘要)，随密码变更自动失效，无需单独存会话
 * - 校验用 timingSafeEqual 防时序侧信道；登录失败做简单的内存级退避
 * 层次约束：只依赖 db / node:crypto，与 app-settings.ts 同层
 */
import { createHash, timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

const ACCESS_PASSWORD_KEY = 'access_password_hash'
export const ACCESS_COOKIE = 'hb_access'

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex')
}

function tokenFor(hash: string): string {
  return sha256(`huobao-access:${hash}`)
}

async function getHash(): Promise<string | null> {
  const [row] = await db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, ACCESS_PASSWORD_KEY))
  return typeof row?.value === 'string' && row.value ? row.value : null
}

/** 当前访问令牌（未启用密码时为 null）；登录成功后下发 */
export async function currentToken(): Promise<string | null> {
  const hash = await getHash()
  return hash ? tokenFor(hash) : null
}

/** 是否已启用访问密码 */
export async function hasAccessPassword(): Promise<boolean> {
  return (await getHash()) !== null
}

/** 设置/清除访问密码（空串清除）；返回新令牌（清除时 null） */
export async function setAccessPassword(password: unknown): Promise<string | null> {
  const raw = typeof password === 'string' ? password : ''
  if (!raw) {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, ACCESS_PASSWORD_KEY))
    return null
  }
  if (raw.length < 4) throw new Error('密码至少 4 位')
  if (raw.length > 128) throw new Error('密码最长 128 位')
  const hash = sha256(raw)
  await db.insert(schema.appSettings)
    .values({ key: ACCESS_PASSWORD_KEY, value: hash, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: hash, updatedAt: now() },
    })
  return tokenFor(hash)
}

/** 校验明文密码 */
export async function verifyAccessPassword(password: unknown): Promise<boolean> {
  const hash = await getHash()
  if (!hash || typeof password !== 'string') return false
  try {
    return timingSafeEqual(Buffer.from(sha256(password), 'hex'), Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

/** 令牌是否有效（从 cookie / header / query 取到的值） */
export async function isTokenValid(token: unknown): Promise<boolean> {
  const hash = await getHash()
  if (!hash || typeof token !== 'string' || !token) return false
  const expected = tokenFor(hash)
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  } catch {
    return false
  }
}

// ---- 登录失败退避：同 IP 连续失败越多，等待越久（进程重启清零，够挡暴力枚举） ----
const fails = new Map<string, { count: number; last: number }>()

export function loginBackoffMs(ip: string): number {
  const rec = fails.get(ip)
  if (!rec) return 0
  // 5 分钟无失败记录自动清零
  if (Date.now() - rec.last > 5 * 60_000) { fails.delete(ip); return 0 }
  // 前 3 次不等待，之后指数退避（1s/2s/4s…封顶 60s）
  if (rec.count <= 3) return 0
  return Math.min(2 ** (rec.count - 3) * 1000, 60_000)
}

export function recordLoginFail(ip: string): void {
  const rec = fails.get(ip) || { count: 0, last: 0 }
  rec.count += 1
  rec.last = Date.now()
  fails.set(ip, rec)
}

export function clearLoginFails(ip: string): void {
  fails.delete(ip)
}
