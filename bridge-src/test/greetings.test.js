import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGreetingScheduler, IDLE_TOPICS } from '../greetings.js'

const logger = { info() {}, warn() {} }
const OWNER = '100000001'
const WOO = '100000003'
const ownerDestination = { kind: 'private', userId: OWNER }
const at = value => new Date(value).getTime()

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'whale-greetings-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function textsIn(group) { return IDLE_TOPICS.filter(topic => topic.group === group).map(topic => topic.text) }
function harness(t, options = {}) {
  const dir = temp(t)
  const path = options.path ?? join(dir, 'qq-bridge-greetings.json')
  const calls = []
  let current = new Date(options.start ?? '2026-10-26T10:00:00+08:00')
  const scheduler = createGreetingScheduler({
    path,
    now: () => current,
    logger,
    random: options.random ?? (() => 0),
    send: options.send ?? (async (text, destination) => { calls.push({ text, destination }); return { sent: 1 } }),
  })
  return { path, calls, scheduler, now: () => current, setAt: value => { current = new Date(value) } }
}

test('topic library covers every slot with short single-question whispers', () => {
  const groups = {}
  for (const topic of IDLE_TOPICS) {
    assert.ok([...topic.text].length <= 20, `${topic.id} exceeds 20 characters`)
    assert.ok((topic.text.match(/[？?]/g) ?? []).length <= 1, `${topic.id} asks more than one question`)
    assert.ok(topic.id.startsWith(topic.group + '-'))
    groups[topic.group] = (groups[topic.group] ?? 0) + 1
  }
  assert.ok(IDLE_TOPICS.length >= 36)
  assert.ok(groups.morning >= 6, 'morning topics')
  assert.ok(groups.noon >= 5, 'noon topics')
  assert.ok(groups.afternoon >= 6, 'afternoon topics')
  assert.ok(groups.evening >= 7, 'evening topics')
  assert.ok(groups.night >= 4, 'night topics')
  assert.ok(groups.care >= 5, 'care topics')
  assert.ok(groups.curious >= 7, 'curious topics')
})

test('scheduled greeting sends once inside the grace window and never twice', async t => {
  const h = harness(t, { start: '2026-10-26T08:30:05+08:00' })
  await h.scheduler.tick()
  await h.scheduler.tick()
  await createGreetingScheduler({ path: h.path, now: h.now, logger, send: async () => { throw new Error('must not resend') } }).tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].text, h.scheduler.status().config.ownerText)
  assert.deepEqual(h.calls[0].destination, ownerDestination)
  h.setAt('2026-10-26T08:35:05+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].text, h.scheduler.status().config.wooText)
  assert.deepEqual(h.calls[1].destination, { kind: 'private', userId: WOO })
})

test('scheduled greeting outside the grace window is skipped', async t => {
  const h = harness(t, { start: '2026-10-26T08:46:00+08:00' })
  await h.scheduler.tick()
  h.setAt('2026-10-26T08:29:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 0)
})

test('a corrupt ledger pauses every automatic send', async t => {
  const dir = temp(t)
  const path = join(dir, 'greetings.json')
  writeFileSync(path, '{ not json')
  const warnings = []
  const h = harness(t, { path, start: '2026-10-26T08:30:05+08:00', send: async () => ({ sent: 1 }) })
  const scheduler = createGreetingScheduler({ path, now: h.now, logger: { warn: message => warnings.push(message) }, send: async () => { throw new Error('paused') } })
  await scheduler.tick()
  assert.equal(scheduler.status().config.enabled, false)
  assert.equal(scheduler.status().config.idleEnabled, false)
  assert.ok(warnings.length >= 1)
})

test('the scheduled ledger keeps only the current day', async t => {
  const h = harness(t, { start: '2026-10-26T08:30:05+08:00' })
  await h.scheduler.tick()
  const first = Object.keys(h.scheduler.status().jobs)
  assert.ok(first.length > 0)
  assert.ok(first.every(key => key.startsWith('2026-10-26')))
  h.setAt('2026-10-27T08:30:05+08:00')
  await h.scheduler.tick()
  assert.ok(Object.keys(h.scheduler.status().jobs).every(key => key.startsWith('2026-10-27')))
})

test('a crashed scheduled send is claimed durably and never resent after reload', async t => {
  const path = join(temp(t), 'greetings.json')
  let calls = 0
  const now = () => new Date('2026-10-26T08:30:05+08:00')
  await createGreetingScheduler({ path, now, logger, send: async () => { calls++; throw new Error('ambiguous timeout') } }).tick()
  await createGreetingScheduler({ path, now, logger, send: async () => { calls++; return { sent: 1 } } }).tick()
  assert.equal(calls, 1)
})

test('a known disconnected scheduled greeting retries after 30 seconds', async t => {
  const path = join(temp(t), 'greetings.json')
  let calls = 0
  let current = new Date('2026-10-26T08:30:05+08:00')
  const scheduler = createGreetingScheduler({ path, now: () => current, logger, send: async () => ++calls === 1 ? { sent: 0, dropped: true, reason: 'not-connected' } : { sent: 1 } })
  await scheduler.tick()
  await scheduler.tick()
  assert.equal(calls, 1)
  current = new Date('2026-10-26T08:30:35+08:00')
  await scheduler.tick()
  assert.equal(calls, 2)
})

test('set validates the new idle settings and persists them', async t => {
  const h = harness(t)
  assert.throws(() => h.scheduler.set({ times: '25:00' }), /HH:mm/)
  assert.throws(() => h.scheduler.set({ ownerId: 'abc' }), /QQ 号/)
  assert.throws(() => h.scheduler.set({ enabled: 'yes' }), /enabled/)
  assert.throws(() => h.scheduler.set({ idleEnabled: 'yes' }), /idleEnabled/)
  assert.throws(() => h.scheduler.set({ graceMinutes: 61 }), /0-60/)
  assert.throws(() => h.scheduler.set({ idleSilentMinutes: 59 }), /60-720/)
  assert.throws(() => h.scheduler.set({ idleSilentMinutes: 721 }), /60-720/)
  assert.throws(() => h.scheduler.set({ idleGapMinutes: 59 }), /60-720/)
  assert.throws(() => h.scheduler.set({ idleMaxPerDay: 0 }), /1-4/)
  assert.throws(() => h.scheduler.set({ idleMaxPerDay: 5 }), /1-4/)
  assert.throws(() => h.scheduler.set({ activeFrom: '25:00' }), /HH:mm/)
  assert.throws(() => h.scheduler.set({ activeTo: '9:00' }), /HH:mm/)
  assert.throws(() => h.scheduler.set({ activeFrom: '23:00', activeTo: '05:00' }), /跨午夜/)
  const saved = h.scheduler.set({ idleSilentMinutes: 90, idleGapMinutes: 100, idleMaxPerDay: 3, activeFrom: '10:00', activeTo: '12:00' })
  assert.equal(saved.config.idleSilentMinutes, 90)
  const reloaded = createGreetingScheduler({ path: h.path, now: h.now, logger, send: async () => ({ sent: 1 }) })
  assert.equal(reloaded.status().config.activeFrom, '10:00')
  assert.equal(reloaded.status().config.activeTo, '12:00')
  assert.equal(reloaded.status().config.idleMaxPerDay, 3)
  assert.equal(reloaded.status().config.idleEnabled, true)
})

test('idle chat greets the owner after long silence with one short line', async t => {
  const h = harness(t, { start: '2026-10-26T10:00:00+08:00' })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T05:30:00+08:00') })
  await h.scheduler.tick()
  assert.equal(h.calls.length, 1)
  assert.ok([...h.calls[0].text].length <= 20)
  assert.ok((h.calls[0].text.match(/[？?]/g) ?? []).length <= 1)
  assert.deepEqual(h.calls[0].destination, ownerDestination)
  let state = h.scheduler.status()
  assert.equal(typeof state.activity.ownerLastAt, 'number')
  assert.equal(state.activity.lastIdleReplied, false)
  assert.equal(state.activity.idleCount, 1)
  assert.equal(state.idle.eligible, false)
  assert.equal(state.idle.reason, 'unanswered-wait')
  // An unanswered opening is not repeated immediately.
  await h.scheduler.tick()
  assert.equal(h.calls.length, 1)
  // A reply clears the unanswered flag and refreshes the silence clock.
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T10:01:00+08:00') })
  state = h.scheduler.status()
  assert.equal(state.activity.lastIdleReplied, true)
  h.setAt('2026-10-26T10:02:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 1)
  // status() is a clone; mutating it cannot corrupt the ledger.
  state.config.ownerId = '000'
  assert.equal(h.scheduler.status().config.ownerId, OWNER)
})

test('idle chat respects the active window', async t => {
  const h = harness(t, { start: '2026-10-26T23:30:00+08:00' })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T18:00:00+08:00') })
  await h.scheduler.tick()
  h.setAt('2026-10-27T08:00:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 0)
})

test('idle chat keeps the configured gap between messages', async t => {
  const h = harness(t, { start: '2026-10-26T09:00:00+08:00' })
  h.scheduler.set({ idleSilentMinutes: 60, idleGapMinutes: 360 })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T09:00:00+08:00') })
  h.setAt('2026-10-26T10:00:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 1)
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T10:01:00+08:00') })
  h.setAt('2026-10-26T11:10:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.scheduler.status().idle.reason, 'gap')
  h.setAt('2026-10-26T16:30:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 2)
})

test('idle chat stops at the daily limit', async t => {
  const h = harness(t, { start: '2026-10-26T09:00:00+08:00' })
  h.scheduler.set({ idleSilentMinutes: 60, idleGapMinutes: 60, idleMaxPerDay: 2 })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T09:00:00+08:00') })
  h.setAt('2026-10-26T10:00:00+08:00')
  await h.scheduler.tick()
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T10:01:00+08:00') })
  h.setAt('2026-10-26T11:10:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 2)
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T11:11:00+08:00') })
  h.setAt('2026-10-26T12:20:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 2)
  assert.equal(h.scheduler.status().idle.reason, 'daily-limit')
})

test('an unanswered idle message is sent at most once per day', async t => {
  const h = harness(t, { start: '2026-10-26T09:00:00+08:00' })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T05:00:00+08:00') })
  await h.scheduler.tick()
  assert.equal(h.calls.length, 1)
  h.setAt('2026-10-26T12:20:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.scheduler.status().idle.reason, 'unanswered-today')
  // A new local day lifts the one-unanswered-per-day ban.
  h.setAt('2026-10-27T09:10:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 2)
})

test('noteInbound only tracks the owner and refreshes the quiet clock', async t => {
  const h = harness(t)
  h.scheduler.noteInbound({ userId: '99999', at: at('2026-10-26T05:00:00+08:00') })
  assert.equal(h.scheduler.status().activity.ownerLastAt, null)
  h.scheduler.noteInbound({ userId: Number(OWNER), at: at('2026-10-26T05:00:00+08:00') })
  assert.equal(h.scheduler.status().activity.ownerLastAt, at('2026-10-26T05:00:00+08:00'))
})

test('recent moods steer the topic group and stale/weak moods are ignored', async t => {
  for (const [mood, group] of [['sad', 'care'], ['cry', 'care'], ['tired', 'care'], ['angry', 'care'], ['happy', 'curious']]) {
    const h = harness(t, { start: '2026-10-26T10:00:00+08:00' })
    h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T05:00:00+08:00') })
    h.scheduler.noteMood({ label: mood, intensity: 3, at: at('2026-10-26T09:50:00+08:00') })
    await h.scheduler.tick()
    assert.equal(h.calls.length, 1)
    assert.ok(textsIn(group).includes(h.calls[0].text), `${mood} should pick a ${group} line`)
  }
  const h = harness(t, { start: '2026-10-26T10:00:00+08:00' })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T05:00:00+08:00') })
  h.scheduler.noteMood({ label: 'sad', intensity: 2, at: at('2026-10-26T09:50:00+08:00') })
  assert.equal(h.scheduler.status().activity.lastMood, null)
  h.scheduler.noteMood({ label: 'neutral', intensity: 5, at: at('2026-10-26T09:50:00+08:00') })
  assert.equal(h.scheduler.status().activity.lastMood, null)
  h.scheduler.noteMood({ label: 'sad', intensity: 4, at: at('2026-10-25T20:00:00+08:00') })
  await h.scheduler.tick()
  assert.ok(textsIn('morning').includes(h.calls[0].text))
})

test('idle topics do not repeat within 14 days', async t => {
  const h = harness(t, { start: '2026-10-01T10:00:00+08:00' })
  h.scheduler.set({ idleSilentMinutes: 60, idleGapMinutes: 60 })
  for (let day = 1; day <= 7; day++) {
    const date = `2026-10-0${day}T10:00:00+08:00`
    h.setAt(date)
    h.scheduler.noteInbound({ userId: OWNER, at: at(`2026-10-0${day}T05:00:00+08:00`) })
    await h.scheduler.tick()
  }
  assert.equal(h.calls.length, 7)
  assert.equal(new Set(h.calls.map(call => call.text)).size, 7)
  // Exactly 14 days after its first use, the oldest morning line is allowed again.
  h.setAt('2026-10-15T10:00:00+08:00')
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-15T05:00:00+08:00') })
  await h.scheduler.tick()
  assert.equal(h.calls.length, 8)
  assert.equal(h.calls.at(-1).text, h.calls[0].text)
})

test('a known disconnected idle message retries after 30 minutes without counting', async t => {
  const path = join(temp(t), 'greetings.json')
  let current = new Date('2026-10-26T09:10:00+08:00')
  let calls = 0
  const scheduler = createGreetingScheduler({ path, now: () => current, logger, random: () => 0, send: async () => ++calls === 1 ? { sent: 0, dropped: true, reason: 'not-connected' } : { sent: 1 } })
  scheduler.set({ idleSilentMinutes: 60, idleGapMinutes: 60 })
  scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T05:00:00+08:00') })
  await scheduler.tick()
  assert.equal(calls, 1)
  assert.equal(scheduler.status().activity.idleCount, 0)
  assert.equal(scheduler.status().activity.lastIdleAt, null)
  current = new Date('2026-10-26T09:39:00+08:00')
  await scheduler.tick()
  assert.equal(calls, 1)
  current = new Date('2026-10-26T09:41:00+08:00')
  await scheduler.tick()
  assert.equal(calls, 2)
  assert.equal(scheduler.status().activity.idleCount, 1)
})

test('an ambiguous idle send is never retried automatically or counted', async t => {
  let attempts = 0
  const h = harness(t, { start: '2026-10-26T09:10:00+08:00', send: async () => { attempts++; throw new Error('timeout') } })
  h.scheduler.set({ idleSilentMinutes: 60, idleGapMinutes: 60 })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T05:00:00+08:00') })
  await h.scheduler.tick()
  assert.equal(attempts, 1)
  const state = h.scheduler.status()
  assert.equal(state.activity.idleCount, 0)
  assert.equal(state.activity.lastIdleReplied, false)
  assert.equal(typeof state.activity.nextIdleAt, 'number')
  h.setAt('2026-10-26T10:30:00+08:00')
  await h.scheduler.tick()
  assert.equal(attempts, 1)
})

test('forceIdle ignores gates and idleEnabled without consuming the real quota', async t => {
  const h = harness(t, { start: '2026-10-26T03:00:00+08:00' })
  h.scheduler.set({ idleEnabled: false })
  h.scheduler.noteInbound({ userId: OWNER, at: at('2026-10-26T02:59:00+08:00') })
  const forced = await h.scheduler.forceIdle()
  assert.equal(forced.ok, true)
  assert.equal(forced.sent, 1)
  assert.equal(forced.text, h.calls[0].text)
  assert.ok([...forced.text].length <= 20)
  assert.deepEqual(h.calls[0].destination, ownerDestination)
  let state = h.scheduler.status()
  assert.equal(state.activity.idleCount, 0)
  assert.equal(state.activity.lastIdleAt, null)
  assert.equal(state.activity.lastForcedText, forced.text)
  // A forced test must not block the real idle path on the next eligible tick.
  h.scheduler.set({ idleEnabled: true })
  h.setAt('2026-10-26T10:00:00+08:00')
  await h.scheduler.tick()
  assert.equal(h.calls.length, 2)
  state = h.scheduler.status()
  assert.equal(state.activity.idleCount, 1)
})

test('forceIdle can pin a topic or reject an unknown one', async t => {
  const h = harness(t, { start: '2026-10-26T12:00:00+08:00' })
  const forced = await h.scheduler.forceIdle({ topic: 'night-3' })
  assert.equal(forced.ok, true)
  assert.equal(forced.text, '今晚的月亮好看吗？')
  assert.equal(h.scheduler.status().activity.lastForcedTopicId, 'night-3')
  const before = h.calls.length
  const missing = await h.scheduler.forceIdle({ topic: 'missing-topic' })
  assert.equal(missing.ok, false)
  assert.equal(missing.sent, 0)
  assert.equal(missing.reason, 'unknown-topic')
  assert.equal(h.calls.length, before)
})

test('forceIdle follows a recent mood and leaves failures out of the ledger', async t => {
  const h = harness(t, { start: '2026-10-26T10:00:00+08:00' })
  h.scheduler.noteMood({ label: 'happy', intensity: 4, at: at('2026-10-26T09:50:00+08:00') })
  const forced = await h.scheduler.forceIdle()
  assert.equal(forced.ok, true)
  assert.ok(textsIn('curious').includes(forced.text))

  const path = join(temp(t), 'failing.json')
  const failing = createGreetingScheduler({ path, now: () => new Date('2026-10-26T10:00:00+08:00'), logger, send: async () => ({ sent: 0, dropped: true, reason: 'not-connected' }) })
  failing.noteInbound({ userId: OWNER, at: at('2026-10-26T05:00:00+08:00') })
  const failed = await failing.forceIdle()
  assert.equal(failed.ok, false)
  assert.equal(failed.sent, 0)
  assert.equal(failed.reason, 'not-connected')
  const state = failing.status()
  assert.equal(state.activity.idleCount, 0)
  assert.equal(state.activity.lastIdleAt, null)
  assert.equal(state.activity.nextIdleAt, null)
})
