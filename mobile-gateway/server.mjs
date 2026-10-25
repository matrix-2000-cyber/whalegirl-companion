import { createServer } from 'node:https'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { withVisionFallback } from './vision-fallback.mjs'
import {initiativePrompts,initiativePrompt,INITIATIVE_COOLDOWN} from './initiative.mjs'
import {createVisionCache} from './vision-cache.mjs'
import {bridgeKeyPath,dshOrigin,gatewayPort,gatewayRoot} from './runtime.mjs'

export const digest = s => createHash('sha256').update(s).digest('hex')
export class Store {
  constructor(path) {
    this.path = path
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { invites: {}, devices: {}, jobs: {}, history: {} }
    // A process restart cannot prove whether an upstream request completed.
    for (const job of Object.values(this.data.jobs)) if (job.status === 'pending') Object.assign(job, { status: 'uncertain', error: '服务曾重启，发送结果不确定；请先查看记录，不要自动重发' })
    this.save()
  }
  save() { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path + '.tmp', JSON.stringify(this.data), { mode: 0o600 }); renameSync(this.path + '.tmp', this.path) }
  invite(principal) {
    const code = randomBytes(9).toString('base64url')
    this.data.invites[digest(code)] = { principal, expires: Date.now() + 10 * 60_000 }
    this.save(); return code
  }
  pair(code, deviceName) {
    const hash = digest(code), invite = this.data.invites[hash]
    if (!invite || invite.expires < Date.now()) throw Error('配对码无效或已过期，请在电脑重新生成')
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    delete this.data.invites[hash]
    this.data.devices[digest(token)] = { id, principal: invite.principal, name: String(deviceName || '手机').slice(0, 40), created: Date.now() }
    this.save(); return { token, deviceId: id, principal: invite.principal }
  }
  device(auth) { return this.data.devices[digest(String(auth || '').replace(/^Bearer /, ''))] }
  revoke(id) { for (const [hash, d] of Object.entries(this.data.devices)) if (d.id === id) delete this.data.devices[hash]; this.save() }
}

export function app({ store, backend, now = Date.now, adminKey = '',analyze=localVision }) {
  const attempts = new Map(),vision=createVisionCache({now})
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)) }
  async function body(req) {
    let size = 0; const chunks = []
    if (!String(req.headers['content-type']).startsWith('application/json')) throw Error('请使用 JSON 请求')
    for await (const part of req) { size += part.length; if (size > 500_000) throw Error('请求太大'); chunks.push(part) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  return async (req, res) => {
    try {
      const path = new URL(req.url, 'https://local').pathname
      if (req.headers.origin) return json(res, 403, { error: '仅支持已配对的手机 App' })
      if (path.startsWith('/local/')) {
        const loopback = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        if (!loopback || !adminKey || req.headers.authorization !== 'Bearer ' + adminKey) return json(res, 403, { error: '仅限电脑本机管理' })
        if (path === '/local/devices' && req.method === 'GET') return json(res, 200, { devices: Object.values(store.data.devices).map(d => ({ id: d.id, name: d.name, person: d.principal.name })) })
        if (path === '/local/invite' && req.method === 'POST') {
          const principal = (await body(req)).principal
          if (!principal || !['owner','friend'].includes(principal.role) || (principal.role === 'owner') !== (principal.id === 'owner') || !/^(owner|[a-f0-9-]{36})$/.test(principal.id) || typeof principal.name !== 'string') return json(res, 400, { error: '身份无效' })
          return json(res, 200, { code: store.invite(principal) })
        }
        if (path === '/local/revoke' && req.method === 'POST') { store.revoke((await body(req)).id); return json(res, 200, { ok: true }) }
        return json(res, 404, { error: 'Unknown local operation' })
      }
      if (path === '/health' && req.method === 'GET') return json(res, 200, { ok: true, version: '0.1.0' })
      if (path === '/v1/pair' && req.method === 'POST') {
        const ip = req.socket.remoteAddress, t = now(), recent = (attempts.get(ip) || []).filter(a => t - a < 600_000)
        if (recent.length >= 10) return json(res, 429, { error: '配对尝试过多，请10分钟后再试' })
        recent.push(t); attempts.set(ip, recent)
        if (attempts.size > 1000) attempts.delete(attempts.keys().next().value)
        const input = await body(req)
        try { return json(res, 200, store.pair(String(input.code || ''), input.deviceName)) }
        catch { return json(res, 401, { error: '配对码无效或已过期' }) }
      }
      const device = store.device(req.headers.authorization)
      if (!device) return json(res, 401, { error: '设备未配对或已被撤销，请重新配对' })
      const pid = device.principal.id
      if(path==='/v1/vision/clear'&&req.method==='POST'){vision.clear(device.id);return json(res,200,{ok:true})}
      if(path==='/v1/vision'&&req.method==='POST'){
        const input=await body(req)
        if(typeof input.image!=='string'||input.image.length>440000||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.image))return json(res,400,{error:'画面格式或大小不支持'})
        try{return json(res,200,await vision.observe(device.id,input.image,analyze))}catch{return json(res,502,{error:'这次画面暂未看清，下次继续分析'})}
      }
      if (path === '/v1/me' && req.method === 'GET') return json(res, 200, { principal: device.principal, deviceId: device.id })
      if (path === '/v1/history' && req.method === 'GET') return json(res, 200, { messages: store.data.history[pid] || [] })
      if (path.startsWith('/v1/jobs/') && req.method === 'GET') {
        const job = store.data.jobs[path.slice('/v1/jobs/'.length)]
        return job?.principalId === pid ? json(res, 200, job) : json(res, 404, { error: '没有这条消息' })
      }
      if (path === '/v1/chat' && req.method === 'POST') {
        const input = await body(req)
        if (!/^[a-f0-9-]{36}$/.test(input.id || '')) return json(res, 400, { error: '消息编号无效' })
        const old = store.data.jobs[input.id]
        if (old) return old.principalId === pid ? json(res, 200, old) : json(res, 409, { error: '消息编号冲突' })
        if (Object.values(store.data.jobs).some(j => j.principalId === pid && j.status === 'pending')) return json(res, 409, { error: '她还在回复上一条，请稍等' })
        const initiative=Object.hasOwn(initiativePrompts,input.initiative)?input.initiative:null
        if(input.initiative&&!initiative)return json(res,400,{error:'主动话题类型无效'})
        if(initiative&&Object.values(store.data.jobs).some(j=>j.principalId===pid&&j.initiative&&now()-j.created<INITIATIVE_COOLDOWN))return json(res,429,{error:'刚刚主动聊过，先等你回应'})
        const text = initiative?initiativePrompt(initiative,!!input.image||!!(input.useVision&&vision.read(device.id))):String(input.text || '').trim()
        if (!text || [...text].length > 2000) return json(res, 400, { error: '请输入1到2000字' })
        // Live-video turns need a longer, self-driven answer. The bridge's own
        // system notice is loaded at plugin start, so enforce it here as well.
        const bridgeText = input.realtime === true && !initiative
          ? '[视频通话模式] 主动带话题，一次说 150–250 字（约 1–2 分钟）：先回应，再自然展开一个小观察、小故事或问题；不要只一两句，也不要长篇独白到停不下来。\n' + text
          : text
        if (input.image && (typeof input.image !== 'string' || input.image.length > 440_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.image))) return json(res, 400, { error: '画面格式或大小不支持' })
        const job = { id: input.id, principalId: pid, status: 'pending', created: now(),...(initiative?{initiative}:{}) }
        store.data.jobs[input.id] = job
        const history = store.data.history[pid] ||= []
        if(!initiative)history.push({ id: input.id, role: 'user', text, at: now() })
        if (history.length > 100) history.splice(0, history.length - 100)
        // Bound completed receipts, never evict a pending request.
        const done = Object.values(store.data.jobs).filter(j => j.status !== 'pending').sort((a,b) => a.created - b.created)
        for (const oldJob of done.slice(0, Math.max(0, done.length - 1000))) delete store.data.jobs[oldJob.id]
        store.save()
        json(res, 202, job)
        const observation=input.useVision===true&&!input.image?vision.read(device.id):null
        const faceCue=(input.image||observation)&&['smile','brow','raisedBrows','downturned','mouthOpen','eyesClosed','nod','shake','neutral'].includes(input.faceCue)?input.faceCue:undefined
        void Promise.resolve().then(() => backend({ id:input.id,principal: device.principal, text:bridgeText, image: input.image,...(initiative?{initiative}:{}),...(observation?{visualContext:observation.text,visualAgeMs:observation.ageMs}:{}),...(faceCue?{faceCue}:{}),...(input.realtime===true?{realtime:true,onProgress:value=>{if(job.status==='pending'&&typeof value==='string')job.partial=value.slice(0,12000)}}:{}) })).then(result => {
          if (!result?.text) throw Error('她暂时没有回复')
          Object.assign(job, { status: 'done', text: result.text, finished: now(),...(result.timings?{timings:result.timings}:{}),...(result.warning?{warning:result.warning,vision:result.vision}:{}) })
          history.push({ id: input.id + '-reply', role: 'assistant', text: result.text, at: now() })
          if (history.length > 100) history.splice(0, history.length - 100)
          store.save()
        }).catch(error => { Object.assign(job, { status: 'failed', error: error.message || '暂时无法连接鲸鱼娘', finished: now() }); store.save() })
        return
      }
      return json(res, 404, { error: '没有这个功能' })
    } catch { if (!res.headersSent) json(res, 400, { error: '请求格式不正确' }); else res.end() }
  }
}

export async function localBackend(input) {
  const keyPath = bridgeKeyPath()
  if (!existsSync(keyPath)) throw Error('电脑端手机桥接尚未启用')
  const key = JSON.parse(readFileSync(keyPath, 'utf8')).key
  let polling=false,stopped=false
  const timer=input.realtime&&input.onProgress?setInterval(async()=>{
    if(polling||stopped)return;polling=true
    try{
      const res=await fetch(dshOrigin()+'/api/whale-mobile/progress',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({id:input.id}),signal:AbortSignal.timeout(3000)})
      const value=await res.json();if(!stopped&&value.ok&&value.text)input.onProgress(value.text)
    }catch{/* A missing progress packet must never replay the conversation. */}finally{polling=false}
  },120):null
  try{return await withVisionFallback(input,async payload=>{
    const response = await fetch(dshOrigin()+'/api/whale-mobile/chat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(payload), signal: AbortSignal.timeout(190000) })
    const result=await response.json()
    if(!response.ok&&!result.error)throw Error('电脑端服务不可用')
    return result
  })}finally{stopped=true;clearInterval(timer)}
}
export async function localVision(image){
  const key=JSON.parse(readFileSync(bridgeKeyPath(),'utf8')).key
  const response=await fetch(dshOrigin()+'/api/whale-mobile/vision',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({image,question:'描述可见人物、动作、手持物、衣着和环境。只写确定看见的事实，模糊处说明不确定，不推断真实心情。'}),signal:AbortSignal.timeout(18000)})
  const value=await response.json();if(!response.ok||!value.ok)throw Error('画面分析暂不可用');return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = gatewayRoot(), tls = JSON.parse(readFileSync(join(root, 'tls.json'), 'utf8'))
  const store = new Store(join(root, 'state.json'))
  const server = createServer({ key: tls.key, cert: tls.cert }, app({ store, backend: localBackend, adminKey: digest(tls.key) }))
  const lan = process.argv.includes('--lan'), host = lan ? '0.0.0.0' : '127.0.0.1'
  server.requestTimeout = 200_000; server.headersTimeout = 15000
  server.listen(gatewayPort(), host, () => console.log(`WhaleGirl mobile gateway listening on ${host}:${gatewayPort()} (HTTPS, paired devices only)`))
}
