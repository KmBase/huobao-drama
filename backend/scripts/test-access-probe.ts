import app from '../src/index.js'

const mk = (path: string, opts?: RequestInit) => new Request('http://x' + path, opts)
const call = (path: string, opts?: RequestInit) => app.fetch(opts ? mk(path, opts) : mk(path))
const j = async (r: Response) => { try { return await r.json() } catch { return '(non-json)' } }

let r = await call('/api/v1/dramas')
console.log('no-password dramas:', r.status)

r = await call('/api/v1/access/password', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'abc123' }) })
const set: any = await j(r)
console.log('set:', r.status, set?.data?.token?.slice(0, 8))
const token = set?.data?.token

r = await call('/api/v1/dramas')
console.log('after-set no-token:', r.status)
r = await call('/api/v1/dramas', { headers: { 'x-access-token': token } })
console.log('with header token:', r.status)
r = await call('/api/v1/dramas', { headers: { cookie: `hb_access=${token}` } })
console.log('with cookie:', r.status)
r = await call('/static/whatever.png')
console.log('static no token:', r.status)

r = await call('/api/v1/access/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })
console.log('wrong login:', r.status, JSON.stringify(await j(r)))
r = await call('/api/v1/access/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'abc123' }) })
console.log('right login:', r.status, 'set-cookie:', (r.headers.get('set-cookie') || '').slice(0, 50))
r = await call('/api/v1/access/status', { headers: { cookie: `hb_access=${token}` } })
console.log('status with cookie:', JSON.stringify(await j(r)))
r = await call('/api/v1/access/logout', { method: 'POST', headers: { cookie: `hb_access=${token}` } })
console.log('logout:', r.status)
r = await call('/api/v1/dramas', { headers: { 'x-access-token': token } })
console.log('after-clear dramas:', r.status)
process.exit(0)
