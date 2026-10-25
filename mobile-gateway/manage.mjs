import { X509Certificate, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { request } from 'node:https'
import QRCode from 'qrcode'
import { Store, digest } from './server.mjs'
const root = resolve('.mobile-gateway')
mkdirSync(root, { recursive: true })
const tls = JSON.parse(readFileSync(join(root, 'tls.json'), 'utf8'))
async function control(operation, payload) {
  try {
    return await new Promise((resolve, reject) => {
      const req = request('https://127.0.0.1:3091/local/' + operation, { method: payload ? 'POST' : 'GET', ca: tls.cert, checkServerIdentity: () => undefined,
        headers: { authorization: 'Bearer ' + digest(tls.key), 'content-type': 'application/json' }, timeout: 5000 }, res => {
        let text = ''; res.on('data', c => text += c); res.on('end', () => {
          try { const result = JSON.parse(text); res.statusCode === 200 ? resolve(result) : reject(Error('Local administration rejected')) } catch (e) { reject(e) }
        })
      }); req.on('error', reject); req.on('timeout', () => req.destroy(Error('Local administration timed out'))); req.end(payload ? JSON.stringify(payload) : undefined)
    })
  } catch (e) {
    if (e.code !== 'ECONNREFUSED') throw e
    const store = new Store(join(root, 'state.json'))
    if (operation === 'invite') return { code: store.invite(payload.principal) }
    if (operation === 'revoke') { store.revoke(payload.id); return { ok: true } }
    return { devices: Object.values(store.data.devices).map(d => ({ id: d.id, name: d.name, person: d.principal.name })) }
  }
}
const [command, kind, name, endpoint] = process.argv.slice(2)
if (command === 'devices') {
  console.log(JSON.stringify(await control('devices'), null, 2))
} else if (command === 'revoke') {
  await control('revoke', { id: kind }); console.log('Device revoked')
} else if (command === 'invite') {
  if (!['owner','friend'].includes(kind) || !name || !endpoint) throw Error('Usage: invite owner|friend NAME https://PC-IP:3091')
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/') throw Error('An HTTPS origin is required')
  const fingerprint = new X509Certificate(tls.cert).fingerprint256.replaceAll(':', '').toLowerCase()
  const { code } = await control('invite', { principal: { id: kind === 'owner' ? 'owner' : randomUUID(), role: kind, name: name.slice(0,30) } })
  const payload = JSON.stringify({ url: url.origin, fingerprint, code })
  const qr = await QRCode.toDataURL(payload, { width: 400, errorCorrectionLevel: 'M' })
  // Pairing secrets stay in this local file, never in console/chat output.
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>鲸鱼娘设备配对</title><style>body{font:18px system-ui;background:#eef7fc;color:#17374c;max-width:720px;margin:50px auto;padding:24px;text-align:center}textarea{width:100%;height:120px}</style><h1>鲸鱼娘 · 手机配对</h1><p>用 App 扫描二维码；10分钟有效，仅可使用一次。</p><img alt="一次性配对二维码" src="${qr}"><p>也可将以下内容复制到 App 的配对框：</p><textarea readonly>${payload.replaceAll('&','&amp;').replaceAll('<','&lt;')}</textarea><p>朋友请生成独立二维码，不要共用主人的配对信息。</p></html>`
  const path = join(root, `invite-${kind}.html`)
  writeFileSync(path, html, { mode: 0o600 })
  console.log('Pairing page saved locally: ' + path)
} else throw Error('Commands: invite, devices, revoke')
