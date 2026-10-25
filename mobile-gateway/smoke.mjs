// Explicit live smoke: creates and revokes its own test device, sends exactly
// one owner message, checks the complete QQ outbox hash, and prints no secrets.
import { request } from 'node:https'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digest } from './server.mjs'
if (!process.argv.includes('--live')) throw Error('Use --live to authorize one real model request')
const tls = JSON.parse(readFileSync('.mobile-gateway/tls.json', 'utf8'))
function call(path, token, body) {
  return new Promise((resolve,reject) => {
    const req = request('https://127.0.0.1:3091' + path, { method: body ? 'POST' : 'GET', ca: tls.cert, checkServerIdentity: () => undefined, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', c => text += c); res.on('end', () => {
        try { const result = JSON.parse(text); if (res.statusCode >= 300) reject(Error(result.error)); else resolve(result) } catch(e) { reject(e) }
      })
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined)
  })
}
const outboxHash = () => digest(JSON.stringify(JSON.parse(readFileSync(join(homedir(), '.dsh/qq-bridge-state.json'), 'utf8')).outbox))
const admin = digest(tls.key), start = Date.now(), before = outboxHash()
const { code } = await call('/local/invite', admin, { principal: { id: 'owner', role: 'owner', name: '爸爸' } })
const paired = await call('/v1/pair', '', { code, deviceName: 'Temporary integration test' })
try {
  const id = randomUUID()
  let job = await call('/v1/chat', paired.token, { id, text: '手机端连接验证：只回复“连接正常”，不要查询或写入记忆，不发QQ消息。' })
  const deadline = Date.now() + 195000
  while (job.status === 'pending' && Date.now() < deadline) { await new Promise(r => setTimeout(r, 800)); job = await call('/v1/jobs/' + id, paired.token) }
  if (job.status !== 'done') throw Error(job.error || 'Live request did not complete')
  const report = { ok: true, httpsPairingAndChat: true, elapsedMs: Date.now() - start, text: job.text, qqOutboxUnchanged: before === outboxHash() }
  writeFileSync('out/mobile-gateway-live-smoke.json', JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
  if (!report.qqOutboxUnchanged) process.exitCode = 1
} finally { await call('/local/revoke', admin, { id: paired.deviceId }) }
