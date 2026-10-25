import { request } from 'node:https'
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { digest } from '../mobile-gateway/server.mjs'
import {gatewayPort} from '../mobile-gateway/runtime.mjs'

export async function desktopClient(root) {
  const tls = JSON.parse(readFileSync(join(root, 'tls.json'), 'utf8'))
  async function call(path, token, data) {
    return new Promise((resolve, reject) => {
      const req = request('https://127.0.0.1:' + gatewayPort() + path, { method: data ? 'POST' : 'GET', ca: tls.cert, checkServerIdentity: () => undefined,
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, timeout: 15000 }, res => {
        let text = ''; res.on('data', c => text += c); res.on('end', () => {
          try { const result = JSON.parse(text); if (res.statusCode >= 300) reject(Object.assign(Error(result.error || '电脑服务暂时不可用'), { status: res.statusCode })); else resolve(result) } catch(e) { reject(e) }
        })
      }); req.on('error', reject); req.on('timeout', () => req.destroy(Error('电脑服务连接超时'))); req.end(data ? JSON.stringify(data) : undefined)
    })
  }
  const path = join(root, 'desktop-device.json')
  let device = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  if (device) {
    try { await call('/v1/me', device.token) } catch(e) { if (e.status === 401) device = null; else throw e }
  }
  if (!device) {
    const admin = digest(tls.key)
    const { code } = await call('/local/invite', admin, { principal: { id: 'owner', role: 'owner', name: '爸爸' } })
    device = await call('/v1/pair', '', { code, deviceName: 'WhaleGirl desktop' })
    writeFileSync(path + '.tmp', JSON.stringify(device), { mode: 0o600 }); renameSync(path + '.tmp', path)
  }
  return (path, data) => call(path, device.token, data)
}
