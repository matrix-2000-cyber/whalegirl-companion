import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCloudflareDrawer, DRAW_MODEL } from '../drawing.js'

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
const credentials = { accountId: 'a'.repeat(32), token: 'fake-test-token', freePlanConfirmed: true }
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'whale-draw-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const calls = []
  const drawer = createCloudflareDrawer({ stateDir: dir, outputDir: dir, getConfig: () => credentials,
    request: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ success: true, result: { image: png.toString('base64') } }) } }, ...options })
  return { drawer, calls, dir }
}
test('Cloudflare drawer uses only the fixed FLUX model and four steps', async t => {
  const { drawer, calls } = fixture(t)
  const r = await drawer.draw({ prompt: '海边的鲸鱼娘' })
  assert.equal(r.ok, true)
  assert.match(calls[0].url, /api\.cloudflare\.com/)
  assert.ok(calls[0].url.endsWith(DRAW_MODEL))
  assert.equal(JSON.parse(calls[0].options.body).steps, 4)
  assert.equal(calls[0].options.redirect, 'error')
  assert.deepEqual(readFileSync(r.path), png)
  assert.equal(r.remaining, 9)
})
test('missing credentials and unconfirmed Free plan never make requests', async t => {
  for (const config of [{}, { ...credentials, freePlanConfirmed: false }]) {
    const { drawer, calls } = fixture(t, { getConfig: () => config })
    assert.equal((await drawer.draw({ prompt: 'test' })).ok, false)
    assert.equal(calls.length, 0)
  }
})
test('concurrent image requests cannot exceed ten calls per day', async t => {
  const { drawer, calls } = fixture(t)
  const results = await Promise.all(Array.from({ length: 12 }, () => drawer.draw({ prompt: 'test' })))
  assert.equal(calls.length, 10)
  assert.equal(results.filter(r => r.reason === 'daily-limit').length, 2)
})
test('daily usage survives a drawer reload', async t => {
  const { drawer, dir } = fixture(t)
  await drawer.draw({ prompt: 'test' })
  const copy = createCloudflareDrawer({ stateDir: dir, outputDir: dir, getConfig: () => credentials })
  assert.equal(copy.status().used, 1)
})
test('daily quota resets at midnight UTC', async t => {
  let date = new Date('2026-10-24T23:59:59Z')
  const { drawer } = fixture(t, { now: () => date })
  await drawer.draw({ prompt: 'test' })
  date = new Date('2026-10-25T00:00:00Z')
  assert.equal(drawer.status().used, 0)
  assert.equal((await drawer.draw({ prompt: 'test' })).used, 1)
})
test('quota errors are explicit and never trigger retries or another provider', async t => {
  let calls = 0
  const { drawer } = fixture(t, { request: async () => { calls++; return { ok: false, status: 429, json: async () => ({ errors: [{ code: 3040, message: 'secret provider text' }] }) } } })
  const r = await drawer.draw({ prompt: 'test' })
  assert.equal(r.reason, 'quota-or-rate-limit')
  assert.equal(calls, 1)
  assert.equal(drawer.status().used, 1)
  assert.ok(!JSON.stringify(r).includes('secret provider text'))
})
test('network failures consume an attempt without exposing secrets', async t => {
  const { drawer } = fixture(t, { request: async () => { throw new Error(credentials.token) } })
  const r = await drawer.draw({ prompt: 'test' })
  assert.equal(r.ok, false)
  assert.equal(drawer.status().used, 1)
  assert.ok(!JSON.stringify(r).includes(credentials.token))
})
test('provider HTML or invalid image data is never reported as success', async t => {
  const { drawer } = fixture(t, { request: async () => ({ ok: true, json: async () => ({ result: { image: Buffer.from('<html>not an image</html>').toString('base64') } }) }) })
  assert.equal((await drawer.draw({ prompt: 'test' })).ok, false)
})
test('scene-only requests omit the Whale Girl character description', async t => {
  const { drawer, calls } = fixture(t)
  await drawer.draw({ prompt: 'sunset ocean', noSelf: true })
  assert.ok(!JSON.parse(calls[0].options.body).prompt.includes('Whale Girl:'))
})
test('corrupt usage records block requests instead of resetting the quota', async t => {
  const { drawer, calls, dir } = fixture(t)
  writeFileSync(join(dir, 'qq-bridge-draw-usage.json'), '{broken')
  await assert.rejects(drawer.draw({ prompt: 'test' }))
  assert.equal(calls.length, 0)
})
