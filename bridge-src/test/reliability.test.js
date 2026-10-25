import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReplyDelivery, splitReply } from '../delivery.js'
import { createGreetingScheduler } from '../greetings.js'
import { createOneBotTransport } from '../onebot.js'
import { createVideoAnalyzer, asrPython } from '../video.js'

const flush = () => new Promise(resolve => setImmediate(resolve))
const A = { kind: 'private', userId: '10001' }
const B = { kind: 'private', userId: '10002' }
const logger = { info() {}, warn() {} }
function delivery(options = {}) {
  const sent = []
  const router = createReplyDelivery({ transport: { isOpen: () => true, call: async (action, params) => sent.push({ action, params }) }, ...options })
  return { sent, router }
}
function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'whale-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir }

test('20 code points per message, including Chinese and non-BMP emoji', () => {
  for (const text of ['鱼'.repeat(121), '🐋'.repeat(41), '一，二。'.repeat(30)]) {
    const parts = splitReply(text)
    assert.ok(parts.every(p => [...p].length <= 20))
    assert.equal(parts.join(''), text)
  }
})
test('120 characters produce six messages; 121 are wholly rejected', async () => {
  const { router, sent } = delivery()
  router.begin(A)
  assert.equal((await router.sendText('鱼'.repeat(121))).reason, 'turn-limit')
  assert.equal(sent.length, 0)
  assert.equal((await router.sendText('鱼'.repeat(120))).sent, 6)
  assert.equal((await router.sendText('第七条')).reason, 'turn-limit')
})
test('repeated and concurrent tool calls share six-message budget', async () => {
  const { router, sent } = delivery()
  router.begin(A)
  const results = await Promise.all(Array.from({ length: 9 }, () => router.sendText('你好')))
  assert.equal(sent.length, 6)
  assert.equal(results.filter(r => r.reason === 'turn-limit').length, 3)
})
test('images and stickers consume the same quota as text', async () => {
  const { router, sent } = delivery()
  router.begin(A)
  await router.sendText('鱼'.repeat(100))
  assert.equal((await router.sendSegments([{ type: 'image', data: { file: 'base64://abc' } }])).sent, 1)
  assert.equal((await router.sendText('再发')).reason, 'turn-limit')
  assert.equal(sent.length, 6)
})
test('later destination changes cannot reroute a current reply or quote', async () => {
  const { router, sent } = delivery({ quote: () => true })
  const mutable = { ...A }
  router.begin(mutable, 'message-A')
  mutable.userId = B.userId
  assert.equal((await router.sendText('给 A 的回复', B)).reason, 'wrong-destination')
  await router.sendText('给 A 的回复')
  assert.equal(sent[0].params.user_id, A.userId)
  assert.equal(sent[0].params.message[0].data.id, 'message-A')
})
test('a fresh turn gets a new budget and destination', async () => {
  const { router, sent } = delivery()
  const first = router.begin(A)
  await router.sendText('鱼'.repeat(120))
  await router.finish(first)
  await first.done
  router.begin(B)
  await router.sendText('给 B')
  assert.equal(sent.at(-1).params.user_id, B.userId)
})
test('finish drains sends already admitted but rejects later calls', async () => {
  const { router, sent } = delivery()
  const lease = router.begin(A)
  const sending = router.sendText('你好')
  const finishing = router.finish(lease)
  assert.equal((await sending).sent, 1)
  assert.equal((await router.sendText('太迟')).reason, 'no-active-turn')
  await finishing
  assert.equal(sent.length, 1)
})
test('disconnection does not consume quota', async () => {
  const { router } = delivery({ transport: { isOpen: () => false } })
  router.begin(A)
  assert.equal((await router.sendText('你好')).reason, 'not-connected')
  assert.equal(router.current().used, 0)
})
test('partial/ambiguous failures retain their reservation and report actual sends', async () => {
  let count = 0
  const { router } = delivery({ transport: { isOpen: () => true, call: async () => { if (++count === 2) throw new Error('timeout') } } })
  router.begin(A)
  const r = await router.sendText('鱼'.repeat(60))
  assert.equal(r.sent, 1)
  assert.equal(r.reason, 'send-failed')
  assert.equal(router.current().used, 2)
})
test('raw text segments cannot bypass the 20-character limit', async () => {
  const { router, sent } = delivery()
  router.begin(A)
  assert.equal((await router.sendSegments([{ type: 'text', data: { text: '鱼'.repeat(21) } }])).reason, 'text-too-long')
  assert.equal(sent.length, 0)
})
test('a known disconnected greeting is retried and persisted across scheduler reload', async t => {
  const path = join(temp(t), 'greetings.json')
  let clock = new Date('2026-10-24T00:30:05Z')
  let calls = 0
  const options = { path, now: () => clock, logger, send: async () => ++calls === 1 ? { sent: 0, dropped: true, reason: 'not-connected' } : { sent: 1, dropped: false } }
  const scheduler = createGreetingScheduler(options)
  await scheduler.tick()
  await scheduler.tick()
  assert.equal(calls, 1)
  clock = new Date('2026-10-24T00:30:40Z')
  await scheduler.tick()
  await createGreetingScheduler(options).tick()
  assert.equal(calls, 2)
  assert.equal(Object.values(JSON.parse(readFileSync(path))).at(0).enabled, true)
})
test('a crashed/ambiguous greeting is never resent after reload', async t => {
  const path = join(temp(t), 'greetings.json')
  let calls = 0
  const options = { path, now: () => new Date('2026-10-24T00:30:05Z'), logger, send: async () => { calls++; throw new Error('ambiguous timeout') } }
  await createGreetingScheduler(options).tick()
  await createGreetingScheduler(options).tick()
  assert.equal(calls, 1)
})
test('concurrent scheduler ticks cannot duplicate a job', async t => {
  let calls = 0
  const scheduler = createGreetingScheduler({ path: join(temp(t), 'g.json'), now: () => new Date('2026-10-24T00:30:05Z'), logger, send: async () => { calls++; await flush(); return { sent: 1 } } })
  await Promise.all([scheduler.tick(), scheduler.tick()])
  assert.equal(calls, 1)
})
test('greeting time, recipient, and enabled setting are configurable and persistent', async t => {
  const path = join(temp(t), 'g.json')
  const options = { path, now: () => new Date('2026-10-24T00:30:05Z'), send: async () => { throw Error('must not send') }, logger }
  const scheduler = createGreetingScheduler(options)
  scheduler.set({ enabled: false, times: '09:00,18:00', ownerId: '12345' })
  assert.throws(() => scheduler.set({ times: '25:00' }))
  const copy = createGreetingScheduler(options)
  assert.deepEqual(copy.status().config.times, ['09:00', '18:00'])
  assert.equal(copy.status().config.ownerId, '12345')
  await copy.tick()
})
test('stale greetings beyond the catch-up window are skipped', async t => {
  let calls = 0
  await createGreetingScheduler({ path: join(temp(t), 'g.json'), now: () => new Date('2026-10-24T00:46:00Z'), send: async () => { calls++ }, logger }).tick()
  assert.equal(calls, 0)
})
test('dispose while token resolution is pending cannot resurrect a WebSocket', async t => {
  const original = globalThis.WebSocket
  t.after(() => { globalThis.WebSocket = original })
  let release, sockets = 0
  globalThis.WebSocket = class { constructor() { sockets++ } }
  const transport = createOneBotTransport({ getUrl: () => 'ws://mock.invalid', getToken: () => new Promise(r => { release = r }), logger })
  transport.start(); transport.dispose(); release(''); await flush()
  assert.equal(sockets, 0)
  assert.equal(transport.status().state, 'idle')
})
test('overlapping reconnects accept only the latest token resolution', async t => {
  const original = globalThis.WebSocket
  t.after(() => { globalThis.WebSocket = original })
  const releases = [], urls = []
  globalThis.WebSocket = class { constructor(url) { urls.push(url); this.readyState = 0 } close() {} }
  const transport = createOneBotTransport({ getUrl: () => 'ws://mock.invalid', getToken: () => new Promise(r => releases.push(r)), logger })
  transport.start(); transport.reconnectNow()
  releases[1]('new'); await flush(); releases[0]('old'); await flush()
  assert.equal(urls.length, 1)
  assert.match(urls[0], /new/)
  transport.dispose()
})
test('24 video frames use six vision calls and clean all temporary files', async t => {
  const root = temp(t), source = join(root, 'source.mp4'), work = join(root, 'work')
  writeFileSync(source, 'fake')
  const batches = []
  const analyze = createVideoAnalyzer({ root: work, logger, python: () => 'mock-python', describeFrames: async frames => { batches.push(frames); return { ok: true, text: '画面描述' } }, run: async (command, args) => {
    if (command === 'ffprobe') return { stdout: '90' }
    if (command === 'ffmpeg' && args.includes('-frames:v')) {
      for (let i = 1; i <= 24; i++) writeFileSync(args.at(-1).replace('%03d', String(i).padStart(3, '0')), 'jpg')
    } else if (command === 'mock-python') writeFileSync(args.at(-1), '台词测试')
    return { stdout: '' }
  } })
  const r = await analyze({ path: source })
  assert.equal(r.ok, true)
  assert.equal(batches.length, 6)
  assert.ok(batches.every(b => b.length === 4))
  assert.match(r.text, /台词测试/)
  assert.deepEqual(readdirSync(work), [])
})
test('empty video analysis is a failure, with explicit ASR warnings', async t => {
  const root = temp(t), source = join(root, 'source.mp4')
  writeFileSync(source, 'fake')
  const analyze = createVideoAnalyzer({ root: join(root, 'work'), logger, describeFrames: async () => ({ ok: false }), run: async command => { if (command === 'ffprobe') return { stdout: '2' }; throw Error('codec unavailable') } })
  const r = await analyze({ path: source })
  assert.equal(r.ok, false)
  assert.deepEqual(readdirSync(join(root, 'work')), [])
})
test('video cancellation is propagated and temporary files are removed', async t => {
  const root = temp(t), source = join(root, 'source.mp4')
  writeFileSync(source, 'fake')
  const controller = new AbortController(); controller.abort()
  const analyze = createVideoAnalyzer({ root: join(root, 'work'), logger, describeFrames: async () => ({ ok: true }), run: async (_command, _args, options) => { options.signal.throwIfAborted() } })
  assert.equal((await analyze({ path: source, signal: controller.signal })).ok, false)
  assert.deepEqual(readdirSync(join(root, 'work')), [])
})
