import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const MINUTE = 60000
const DAY = 86400000
const TOPIC_REUSE_MS = 14 * DAY
const MOOD_FRESH_MS = 8 * 3600000
const MOOD_MAX_AGE_MS = 12 * 3600000
const GREETING_QUIET_MS = 5 * MINUTE
const IDLE_RETRY_MS = 30 * MINUTE

const DEFAULTS = { enabled: true, timezone: 'Asia/Shanghai', ownerId: '100000001', wooId: '100000003',
  times: ['08:30', '12:30', '20:30'], wooTimes: ['08:35', '12:35', '20:35'],
  ownerText: '主人，本鱼来冒个泡～', wooText: '记得好好吃饭呀～', graceMinutes: 10,
  idleEnabled: true, idleSilentMinutes: 210, idleGapMinutes: 150, idleMaxPerDay: 2,
  activeFrom: '09:00', activeTo: '22:30' }

// Spoken by the whale girl when nobody has talked to her for a while. Every line is at
// most 20 characters and contains no more than one question, so it feels like a small
// nudge rather than customer support. Groups are chosen by the local time of day.
export const IDLE_TOPICS = [
  { id: 'morning-1', group: 'morning', text: '爸爸今天起得好早呀' },
  { id: 'morning-2', group: 'morning', text: '早上好，本鱼在晒贝壳' },
  { id: 'morning-3', group: 'morning', text: '爸爸早饭想吃什么？' },
  { id: 'morning-4', group: 'morning', text: '今天的太阳晒着舒服吗？' },
  { id: 'morning-5', group: 'morning', text: '本鱼刚醒，爸爸醒了吗？' },
  { id: 'morning-6', group: 'morning', text: '要不要本鱼陪你吃早饭？' },
  { id: 'morning-7', group: 'morning', text: '今天有没有想做的事？' },
  { id: 'noon-1', group: 'noon', text: '中午了，爸爸吃白米饭了吗？' },
  { id: 'noon-2', group: 'noon', text: '今天午饭有鱼干吗？' },
  { id: 'noon-3', group: 'noon', text: '爸爸中午想吃什么呀？' },
  { id: 'noon-4', group: 'noon', text: '本鱼在闻饭香，你那边呢？' },
  { id: 'noon-5', group: 'noon', text: '午饭吃了没，爸爸？' },
  { id: 'noon-6', group: 'noon', text: '今天中午要不要加个蛋？' },
  { id: 'afternoon-1', group: 'afternoon', text: '下午有点困，爸爸困吗？' },
  { id: 'afternoon-2', group: 'afternoon', text: '本鱼趴在窗边晒太阳，你呢？' },
  { id: 'afternoon-3', group: 'afternoon', text: '爸爸下午忙不忙呀？' },
  { id: 'afternoon-4', group: 'afternoon', text: '要不要一起偷个懒？' },
  { id: 'afternoon-5', group: 'afternoon', text: '爸爸今天喝够水了吗？' },
  { id: 'afternoon-6', group: 'afternoon', text: '本鱼捡到一颗小贝壳，想看吗？' },
  { id: 'evening-1', group: 'evening', text: '爸爸今天过得怎么样？' },
  { id: 'evening-2', group: 'evening', text: '今天有什么想聊的吗？' },
  { id: 'evening-3', group: 'evening', text: '晚饭吃了吗，爸爸？' },
  { id: 'evening-4', group: 'evening', text: '本鱼今天很乖，要夸夸吗？' },
  { id: 'evening-5', group: 'evening', text: '爸爸今天累不累呀？' },
  { id: 'evening-6', group: 'evening', text: '今天有开心的事吗？' },
  { id: 'evening-7', group: 'evening', text: '睡前想跟本鱼说说话吗？' },
  { id: 'evening-8', group: 'evening', text: '爸爸今晚想早点歇吗？' },
  { id: 'night-1', group: 'night', text: '夜里有点凉，爸爸盖好被子' },
  { id: 'night-2', group: 'night', text: '本鱼还没睡，爸爸也没睡吗？' },
  { id: 'night-3', group: 'night', text: '今晚的月亮好看吗？' },
  { id: 'night-4', group: 'night', text: '若睡不着，本鱼陪你待会儿' },
  { id: 'night-5', group: 'night', text: '爸爸此刻在想什么呀？' },
  { id: 'care-1', group: 'care', text: '爸爸，本鱼在这儿' },
  { id: 'care-2', group: 'care', text: '本鱼陪着你，慢慢来' },
  { id: 'care-3', group: 'care', text: '不开心也没关系的' },
  { id: 'care-4', group: 'care', text: '先喝口水，歇一会儿' },
  { id: 'care-5', group: 'care', text: '本鱼轻轻贴一下爸爸' },
  { id: 'care-6', group: 'care', text: '累了就靠岸歇歇吧' },
  { id: 'curious-1', group: 'curious', text: '如果只能吃一样东西，你选什么？' },
  { id: 'curious-2', group: 'curious', text: '爸爸想变成哪种海里的鱼？' },
  { id: 'curious-3', group: 'curious', text: '如果会潜海，最想看什么？' },
  { id: 'curious-4', group: 'curious', text: '你喜欢海还是喜欢山？' },
  { id: 'curious-5', group: 'curious', text: '哪一种贝壳最合你心意？' },
  { id: 'curious-6', group: 'curious', text: '爸爸心里最想去哪儿？' },
  { id: 'curious-7', group: 'curious', text: '如果今天多一小时，你想干啥？' },
  { id: 'curious-8', group: 'curious', text: '本鱼该学哪种鱼游得快？' },
  { id: 'curious-9', group: 'curious', text: '爸爸最近想养成什么小习惯？' },
]

function emptyActivity() {
  return { ownerLastAt: null, lastIdleAt: null, lastIdleAttemptAt: null, lastIdleReplied: true,
    idleDay: null, idleCount: 0, lastMood: null, lastGreetingAt: null, nextIdleAt: null,
    retrySafe: false, lastIdleTopicId: null, lastIdleText: null,
    lastForcedAt: null, lastForcedTopicId: null, lastForcedText: null }
}

function minutesOf(text) { const [h, m] = String(text).split(':').map(Number); return h * 60 + m }

function slotFor(minute) {
  if (minute >= 300 && minute < 660) return 'morning'
  if (minute >= 660 && minute < 840) return 'noon'
  if (minute >= 840 && minute < 1080) return 'afternoon'
  if (minute >= 1080 && minute < 1380) return 'evening'
  return 'night'
}

export function createGreetingScheduler({ path, send, now = () => new Date(), logger = console, random = Math.random }) {
  let store = { config: { ...DEFAULTS }, jobs: {}, activity: emptyActivity(), usedTopics: {} }
  if (existsSync(path)) {
    try { store = JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) {
      // Preserve the corrupt ledger, and stop automatic sends until repaired.
      logger.warn?.(`问候记录损坏，已暂停自动发送：${error.message}`)
      store = { config: { ...DEFAULTS, enabled: false, idleEnabled: false }, jobs: {}, error: '记录损坏，自动发送已暂停' }
    }
  }
  if (!store.jobs || typeof store.jobs !== 'object') throw new Error('问候记录结构损坏')
  store.config = { ...DEFAULTS, ...store.config }
  store.activity = { ...emptyActivity(), ...(store.activity && typeof store.activity === 'object' ? store.activity : {}) }
  store.usedTopics = store.usedTopics && typeof store.usedTopics === 'object' && !Array.isArray(store.usedTopics) ? store.usedTopics : {}
  // A crash between the durable idle claim and its result is ambiguous: it may have been
  // delivered. Treat it as unanswered and never resend it automatically.
  if (store.activity.sending && typeof store.activity.sending === 'object') {
    const claim = store.activity.sending
    const claimedAt = Number(claim.at)
    delete store.activity.sending
    if (Number.isFinite(claimedAt) && claim.forced) {
      // A crashed manual test must not suppress the real idle path.
      store.activity.lastForcedAt = claimedAt
      if (claim.topicId) store.activity.lastForcedTopicId = claim.topicId
    } else if (Number.isFinite(claimedAt)) {
      store.activity.lastIdleAt = claimedAt
      store.activity.lastIdleAttemptAt = claimedAt
      store.activity.lastIdleReplied = false
      store.activity.nextIdleAt = claimedAt + DAY
      store.activity.retrySafe = false
      if (claim.topicId) {
        store.activity.lastIdleTopicId = claim.topicId
        store.usedTopics[claim.topicId] = claimedAt
      }
    }
  }
  let busy = false
  function save() {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path + '.tmp', JSON.stringify(store, null, 2) + '\n')
    renameSync(path + '.tmp', path)
  }
  function localParts(date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: store.config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
    return Object.fromEntries(parts.map(p => [p.type, p.value]))
  }
  function dayOf(ms) { const p = localParts(new Date(ms)); return `${p.year}-${p.month}-${p.day}` }
  function inActiveWindow(minute) {
    return minute >= minutesOf(store.config.activeFrom) && minute < minutesOf(store.config.activeTo)
  }
  // Rough estimate only: the zone offset is sampled at the current instant, so a DST
  // transition between now and the target local time can shift it by about an hour.
  function nextWindowStart(date) {
    const p = localParts(date)
    const minute = Number(p.hour) * 60 + Number(p.minute)
    const from = minutesOf(store.config.activeFrom)
    const offset = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - Math.floor(date.getTime() / MINUTE) * MINUTE
    const addDays = minute < from ? 0 : 1
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + addDays, 0, from) - offset
  }
  function topicGroup(minute, mood, at) {
    if (mood && Number.isFinite(mood.at)) {
      const age = at - mood.at
      if (age >= 0 && age <= MOOD_FRESH_MS && ['sad', 'cry', 'tired'].includes(mood.label)) return 'care'
      if (age >= 0 && age <= MOOD_MAX_AGE_MS && mood.label === 'angry') return 'care'
      if (age >= 0 && age <= MOOD_MAX_AGE_MS && mood.label === 'happy') return 'curious'
    }
    return slotFor(minute)
  }
  function pickTopic(mood, at, parts) {
    const group = topicGroup(Number(parts.hour) * 60 + Number(parts.minute), mood, at)
    let candidates = IDLE_TOPICS.filter(t => t.group === group)
    // An angry owner gets the shortest, softest care lines; no follow-up questions.
    if (group === 'care' && mood?.label === 'angry') candidates = candidates.filter(t => [...t.text].length <= 10)
    const fresh = candidates.filter(t => !Number.isFinite(store.usedTopics[t.id]) || at - store.usedTopics[t.id] >= TOPIC_REUSE_MS)
    let pool = fresh
    if (!pool.length) {
      // Every topic in this group was used during the last 14 days; fall back to the
      // least recently used half instead of refusing to speak.
      pool = [...candidates].sort((a, b) => (Number(store.usedTopics[a.id]) || 0) - (Number(store.usedTopics[b.id]) || 0))
        .slice(0, Math.max(1, Math.ceil(candidates.length / 2)))
    }
    const value = Number(random())
    const index = Number.isFinite(value) ? Math.min(pool.length - 1, Math.max(0, Math.floor(value * pool.length))) : 0
    return pool[index] ?? candidates[0]
  }
  function evaluateIdle(date) {
    const cfg = store.config
    const act = store.activity
    const at = date.getTime()
    const p = localParts(date)
    const day = `${p.year}-${p.month}-${p.day}`
    const minute = Number(p.hour) * 60 + Number(p.minute)
    const unanswered = Boolean(act.lastIdleAt && act.lastIdleReplied === false)
    const base = { eligible: false, reason: null, nextAt: null, slot: slotFor(minute), unanswered,
      todayCount: act.idleDay === day ? act.idleCount : 0, lastTopicId: act.lastIdleTopicId ?? null }
    if (!cfg.idleEnabled) return { ...base, reason: 'disabled' }
    if (!inActiveWindow(minute)) return { ...base, reason: 'window', nextAt: nextWindowStart(date) }
    if (act.nextIdleAt && at < act.nextIdleAt) return { ...base, reason: act.retrySafe ? 'retry' : 'cooldown', nextAt: act.nextIdleAt }
    if (!Number.isFinite(act.ownerLastAt)) return { ...base, reason: 'no-activity' }
    const silentMs = cfg.idleSilentMinutes * MINUTE
    const silence = at - act.ownerLastAt
    if (silence < silentMs) return { ...base, reason: 'silent', nextAt: act.ownerLastAt + silentMs }
    if (unanswered) {
      // No answer yet: wait for double the silence and send at most one unanswered
      // message per local day, so she never nags the owner.
      if (silence < silentMs * 2) return { ...base, reason: 'unanswered-wait', nextAt: act.ownerLastAt + silentMs * 2 }
      if (dayOf(act.lastIdleAt) === day) return { ...base, reason: 'unanswered-today' }
    }
    if (act.lastGreetingAt && at - act.lastGreetingAt < GREETING_QUIET_MS) {
      return { ...base, reason: 'greeting-cooldown', nextAt: act.lastGreetingAt + GREETING_QUIET_MS }
    }
    const gapRef = act.lastIdleAttemptAt ?? act.lastIdleAt
    const safeRetry = act.retrySafe === true && act.nextIdleAt != null && at >= act.nextIdleAt
    if (!safeRetry && gapRef && at - gapRef < cfg.idleGapMinutes * MINUTE) {
      return { ...base, reason: 'gap', nextAt: gapRef + cfg.idleGapMinutes * MINUTE }
    }
    if (base.todayCount >= cfg.idleMaxPerDay) return { ...base, reason: 'daily-limit', nextAt: nextWindowStart(date) }
    return { ...base, eligible: true, nextAt: at }
  }
  function set(patch) {
    const next = { ...store.config }
    for (const key of Object.keys(DEFAULTS)) if (patch[key] !== undefined) next[key] = patch[key]
    for (const key of ['times', 'wooTimes']) {
      const values = Array.isArray(next[key]) ? next[key] : String(next[key]).split(/[,，\s]+/)
      if (values.some(v => !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) throw new Error('时间格式必须为 HH:mm')
      next[key] = [...new Set(values)]
    }
    for (const key of ['activeFrom', 'activeTo']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next[key]))) throw new Error('活跃时段格式必须为 HH:mm')
    // The activity window is a simple same-day range; crossing midnight is rejected.
    if (minutesOf(next.activeFrom) >= minutesOf(next.activeTo)) throw new Error('活跃时段暂不支持跨午夜（开始需早于结束）')
    for (const key of ['ownerId', 'wooId']) if (!/^\d+$/.test(next[key])) throw new Error('QQ 号必须为数字')
    if (typeof next.enabled !== 'boolean') throw new Error('enabled 必须为布尔值')
    if (typeof next.idleEnabled !== 'boolean') throw new Error('idleEnabled 必须为布尔值')
    if (!Number.isInteger(next.graceMinutes) || next.graceMinutes < 0 || next.graceMinutes > 60) throw new Error('补发窗口必须为 0-60 分钟')
    if (!Number.isInteger(next.idleSilentMinutes) || next.idleSilentMinutes < 60 || next.idleSilentMinutes > 720) throw new Error('空闲时长必须为 60-720 分钟')
    if (!Number.isInteger(next.idleGapMinutes) || next.idleGapMinutes < 60 || next.idleGapMinutes > 720) throw new Error('搭话间隔必须为 60-720 分钟')
    if (!Number.isInteger(next.idleMaxPerDay) || next.idleMaxPerDay < 1 || next.idleMaxPerDay > 4) throw new Error('每日搭话上限必须为 1-4 条')
    new Intl.DateTimeFormat('en', { timeZone: next.timezone }).format(now())
    store.config = next
    save()
    return status()
  }
  function status() {
    const snapshot = structuredClone(store)
    delete snapshot.activity.sending
    return { ...snapshot, idle: evaluateIdle(now()) }
  }
  function noteInbound({ userId, at = now().getTime() } = {}) {
    if (String(userId) !== String(store.config.ownerId)) return status()
    const time = Number(at)
    if (!Number.isFinite(time)) return status()
    const act = store.activity
    act.ownerLastAt = Math.max(Number.isFinite(act.ownerLastAt) ? act.ownerLastAt : 0, time)
    if (!act.lastIdleReplied && act.lastIdleAt && time > act.lastIdleAt) act.lastIdleReplied = true
    save()
    return status()
  }
  function noteMood({ label, intensity = 0, at = now().getTime() } = {}) {
    const time = Number(at)
    const value = Number(intensity)
    if (label && Number.isFinite(time) && Number.isFinite(value) && value >= 3 && String(label) !== 'neutral') {
      store.activity.lastMood = { label: String(label), at: time, intensity: value }
      save()
    }
    return status()
  }
  async function runScheduled() {
    const date = now()
    const p = localParts(date)
    const day = `${p.year}-${p.month}-${p.day}`
    const minute = Number(p.hour) * 60 + Number(p.minute)
    for (const who of ['owner', 'woo']) for (const time of store.config[who === 'owner' ? 'times' : 'wooTimes']) {
      const [h, m] = time.split(':').map(Number)
      const age = minute - (h * 60 + m)
      if (age < 0 || age > store.config.graceMinutes) continue
      const key = `${day}/${who}/${time}`
      const old = store.jobs[key]
      if (old?.state === 'sent' || old?.state === 'sending' || old?.state === 'unknown' || old?.retryAt > date.getTime()) continue
      store.jobs[key] = { state: 'sending', at: date.getTime(), attempts: (old?.attempts ?? 0) + 1 }
      save() // Claim durably before sending: reloading cannot duplicate this job.
      let result
      try { result = await send(store.config[who + 'Text'], { kind: 'private', userId: store.config[who + 'Id'] }) }
      catch (e) { result = { reason: 'send-failed', error: e.message } }
      const sent = result?.sent > 0 && !result.dropped
      const safeRetry = result?.sent === 0 && ['not-connected', 'no-active-turn'].includes(result.reason)
      if (sent || !safeRetry) store.activity.lastGreetingAt = date.getTime()
      store.jobs[key] = { ...store.jobs[key], state: sent ? 'sent' : safeRetry ? 'retry' : 'unknown', reason: result?.reason, retryAt: date.getTime() + 30000 }
      // Keep only today's ledger. Ambiguous sends are never retried automatically.
      store.jobs = Object.fromEntries(Object.entries(store.jobs).filter(([key]) => key.startsWith(day)))
      save()
    }
  }
  async function runIdle() {
    const date = now()
    if (!evaluateIdle(date).eligible) return
    const at = date.getTime()
    const p = localParts(date)
    const day = `${p.year}-${p.month}-${p.day}`
    const topic = pickTopic(store.activity.lastMood, at, p)
    const act = store.activity
    act.sending = { at, topicId: topic.id, forced: false }
    save() // Claim durably before sending: a reloading tick cannot duplicate this idle message.
    let result
    try { result = await send(topic.text, { kind: 'private', userId: store.config.ownerId }) }
    catch (error) { result = { reason: 'send-failed', error: error?.message ?? String(error) } }
    delete act.sending
    const sent = result?.sent > 0 && !result.dropped
    const safeRetry = result?.sent === 0 && ['not-connected', 'no-active-turn'].includes(result.reason)
    act.lastIdleAttemptAt = at
    act.lastIdleText = topic.text
    if (sent) {
      act.lastIdleAt = at
      act.lastIdleReplied = false
      act.lastIdleTopicId = topic.id
      if (act.idleDay !== day) { act.idleDay = day; act.idleCount = 0 }
      act.idleCount += 1
      act.nextIdleAt = null
      act.retrySafe = false
      store.usedTopics[topic.id] = at
    } else if (safeRetry) {
      // Nothing was delivered, so retrying the same opening in 30 minutes is safe.
      act.nextIdleAt = at + IDLE_RETRY_MS
      act.retrySafe = true
    } else {
      // Ambiguous (timeout/crash): it may have reached the owner. Treat it as an
      // unanswered message and never retry it automatically.
      act.lastIdleAt = at
      act.lastIdleReplied = false
      act.lastIdleTopicId = topic.id
      act.nextIdleAt = at + DAY
      act.retrySafe = false
      store.usedTopics[topic.id] = at
    }
    save()
  }
  // Manual "proactive chat" test hook (qq_bridge_greeting). It deliberately ignores the
  // quiet gate, gap, daily limit, unanswered suppression and idleEnabled; it only sends
  // through the same durable claim + ledger path so a reload cannot duplicate it. A
  // forced send never consumes the real daily quota, gap or topic cooldown.
  async function forceIdle({ topic } = {}) {
    const requested = topic == null ? '' : String(topic).trim()
    const pinned = requested ? IDLE_TOPICS.find(item => item.id === requested) : null
    if (requested && !pinned) return { ok: false, sent: 0, text: '', reason: 'unknown-topic' }
    if (busy) return { ok: false, sent: 0, text: '', reason: 'busy' }
    busy = true
    try {
      const date = now()
      const at = date.getTime()
      const chosen = pinned ?? pickTopic(store.activity.lastMood, at, localParts(date))
      const act = store.activity
      act.sending = { at, topicId: chosen.id, forced: true }
      save() // Claim durably before sending, exactly like an automatic idle message.
      let result
      try { result = await send(chosen.text, { kind: 'private', userId: store.config.ownerId }) }
      catch (error) { result = { reason: 'send-failed', error: error?.message ?? String(error) } }
      delete act.sending
      const sent = result?.sent > 0 && !result.dropped
      // Test-only marker; real idleCount/lastIdleAt/nextIdleAt/usedTopics stay untouched.
      act.lastForcedAt = at
      act.lastForcedTopicId = chosen.id
      act.lastForcedText = chosen.text
      save()
      const reply = { ok: sent, sent: sent ? result.sent : 0, text: chosen.text }
      if (!sent) reply.reason = result?.reason ?? 'send-failed'
      return reply
    } finally { busy = false }
  }
  async function tick() {
    if (busy || !store.config.enabled) return
    busy = true
    try {
      try { await runScheduled() } catch (error) { logger.warn?.(`主动问候检查失败：${error.message}`) }
      try { await runIdle() } catch (error) { logger.warn?.(`空闲搭话检查失败：${error.message}`) }
    } finally { busy = false }
  }
  return { tick, set, status, noteInbound, noteMood, forceIdle }
}
