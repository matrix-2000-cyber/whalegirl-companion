import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, Store } from '../server.mjs'
import {initiativePrompt,familyTopics} from '../initiative.mjs'

async function fixture(t, backend = async () => ({ text: '在呀～' }),extra={}) {
  const dir = mkdtempSync(join(tmpdir(), 'whale-mobile-')), path = join(dir, 'state.json')
  const store = new Store(path), server = createServer(app({ store, backend, adminKey: 'local-admin',...extra }))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port
  t.after(async () => { await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }) })
  async function request(path, token, data) {
    const res = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
    return { status: res.status, body: await res.json() }
  }
  const owner = { id: 'owner', role: 'owner', name: '爸爸' }
  const friend = { id: randomUUID(), role: 'friend', name: '朋友' }
  async function pair(principal) { return (await request('/v1/pair', '', { code: store.invite(principal), principal: owner })).body.token }
  return { store, path, request, owner, friend, pair }
}

test('one-use pairing binds server-side identity; only token hashes persist; revocation works', async t => {
  const f = await fixture(t), code = f.store.invite(f.friend)
  const paired = await f.request('/v1/pair', '', { code, principal: f.owner, deviceName: 'iPhone' })
  assert.equal(paired.body.principal.role, 'friend')
  assert.equal((await f.request('/v1/pair', '', { code })).status, 401)
  assert.ok(!readFileSync(f.path, 'utf8').includes(paired.body.token))
  assert.equal((await f.request('/v1/me', paired.body.token)).status, 200)
  f.store.revoke(paired.body.deviceId)
  assert.equal((await f.request('/v1/me', paired.body.token)).status, 401)
})

test('retrying a message is idempotent; history and replies are private to their person', async t => {
  let calls = 0, resolve
  const f = await fixture(t, input => { calls++; assert.equal(input.principal.role, 'owner'); return new Promise(r => resolve = r) })
  const owner = await f.pair(f.owner), friend = await f.pair(f.friend), id = randomUUID()
  assert.equal((await f.request('/v1/chat', owner, { id, text: '记住这件事', principal: f.friend })).status, 202)
  assert.equal((await f.request('/v1/chat', owner, { id, text: '重试' })).status, 200)
  assert.equal((await f.request('/v1/chat', friend, { id, text: '偷看' })).status, 409)
  assert.equal((await f.request('/v1/jobs/' + id, friend)).status, 404)
  assert.deepEqual((await f.request('/v1/history', friend)).body.messages, [])
  assert.equal(calls, 1)
  resolve({ text: '本鱼记住啦' })
  for (let n = 0; n < 30 && f.store.data.jobs[id].status === 'pending'; n++) await new Promise(r => setTimeout(r, 5))
  assert.equal((await f.request('/v1/jobs/' + id, owner)).body.text, '本鱼记住啦')
  assert.equal((await f.request('/v1/history', owner)).body.messages.length, 2)
})

test('expired invites, brute-force pairing and unauthenticated administration are rejected', async t => {
  const f = await fixture(t)
  f.store.invite(f.owner)
  for (const invite of Object.values(f.store.data.invites)) invite.expires = 0
  assert.equal((await f.request('/v1/pair', '', { code: 'expired' })).status, 401)
  for (let n = 0; n < 9; n++) await f.request('/v1/pair', '', { code: 'wrong' })
  assert.equal((await f.request('/v1/pair', '', { code: 'wrong' })).status, 429)
  assert.equal((await f.request('/local/devices', '')).status, 403)
  assert.equal((await f.request('/local/devices', 'local-admin')).status, 200)
})

test('restart marks incomplete jobs uncertain instead of replaying them', async t => {
  const f = await fixture(t), id = randomUUID()
  f.store.data.jobs[id] = { id, status: 'pending', principalId: 'owner' }; f.store.save()
  const recovered = new Store(f.path)
  assert.equal(recovered.data.jobs[id].status, 'uncertain')
  assert.match(recovered.data.jobs[id].error, /不确定/)
})

test('continuous vision is isolated per device and combined with chat only when enabled',async t=>{
 const inputs=[],f=await fixture(t,async input=>{inputs.push(input);return {text:'看见啦'}},{analyze:async()=>({text:'示例人物抬手'})})
 const owner=await f.pair(f.owner),otherDevice=await f.pair(f.owner),friend=await f.pair(f.friend)
 const vision=await f.request('/v1/vision',owner,{image:Buffer.from('fixture').toString('base64')})
 assert.equal(vision.body.observation.text,'示例人物抬手')
 async function chat(token,extra){const id=randomUUID();await f.request('/v1/chat',token,{id,text:'今天怎么样',...extra});for(let n=0;n<30&&f.store.data.jobs[id].status==='pending';n++)await new Promise(r=>setTimeout(r,5));return inputs.at(-1)}
 assert.equal((await chat(owner,{useVision:true,faceCue:'nod'})).visualContext,'示例人物抬手')
 assert.equal((await chat(otherDevice,{useVision:true})).visualContext,undefined)
 assert.equal((await chat(friend,{useVision:true})).visualContext,undefined)
 await f.request('/v1/vision/clear',owner,{})
 assert.equal((await chat(owner,{useVision:true})).visualContext,undefined)
})

test('initiative is a bounded app event, not a fabricated user message; retries remain idempotent',async t=>{
 let calls=[]
 const f=await fixture(t,async input=>{calls.push(input);return {text:'你来啦，今天开心吗？'}})
 const token=await f.pair(f.owner),id=randomUUID()
 assert.equal((await f.request('/v1/chat',token,{id,initiative:'camera-open',text:'untrusted replacement'})).status,202)
 for(let n=0;n<30&&f.store.data.jobs[id].status==='pending';n++)await new Promise(r=>setTimeout(r,5))
 assert.equal(calls[0].text,initiativePrompt('camera-open',false,{owner:true,topic:familyTopics[0]}))
 assert.equal(calls[0].initiative,'camera-open')
 assert.match(calls[0].text,/无新镜头，不描述外貌衣着/)
 const messages=(await f.request('/v1/history',token)).body.messages
 assert.deepEqual(messages.map(m=>m.role),['assistant'])
 assert.equal((await f.request('/v1/chat',token,{id,initiative:'camera-open'})).status,200)
 assert.equal(calls.length,1)
 assert.equal((await f.request('/v1/chat',token,{id:randomUUID(),initiative:'idle'})).status,429)
 assert.equal((await f.request('/v1/chat',token,{id:randomUUID(),initiative:'unknown'})).status,400)
 assert.equal((await f.request('/v1/chat',token,{id:randomUUID(),text:'今天很开心'})).status,202)
})
