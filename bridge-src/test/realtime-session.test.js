import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssistantProgress, recentMobileContext } from '../realtime-session.js'

test('native preview arrives before final, excludes reasoning/tools, and final is not duplicated', () => {
  const receipt = { text: '', revision: 0, created: Date.now() }
  const p = createAssistantProgress(receipt)
  p.frame({ type: 'start', attemptId: 'a', revision: 1 })
  p.frame({ type: 'chunk', attemptId: 'other', revision: 2, chunk: { type: 'text-delta', text: '别人的话' } })
  p.frame({ type: 'chunk', attemptId: 'a', revision: 2, chunk: { type: 'reasoning-delta', text: '内部思考' } })
  p.frame({ type: 'chunk', attemptId: 'a', revision: 3, chunk: { type: 'tool-call-delta', text: '参数' } })
  assert.equal(receipt.text, '')
  p.frame({ type: 'chunk', attemptId: 'a', revision: 4, chunk: { type: 'text-delta', text: '在呀。' } })
  assert.equal(receipt.text, '在呀。')
  assert.equal(typeof receipt.firstTextMs, 'number')
  p.frame({ type: 'chunk', attemptId: 'a', revision: 4, chunk: { type: 'text-delta', text: '重复包' } })
  p.frame({ type: 'chunk', attemptId: 'a', revision: 5, chunk: { type: 'text-delta', text: '陪着你呢。' } })
  p.commit('在呀。陪着你呢。')
  p.frame({ type: 'end', attemptId: 'a', revision: 6, outcome: { eventType: 'assistant/message' } })
  assert.equal(receipt.text, '在呀。陪着你呢。')
  assert.equal(p.deltas, 2)
  assert.equal(receipt.revision, 2)
})

test('failed attempt is replaced on retry, successful tool steps append once', () => {
  const receipt = { text: '', revision: 0, created: Date.now() }
  const p = createAssistantProgress(receipt)
  p.commit('我查查。')
  p.frame({ type: 'start', attemptId: 'a', revision: 1 })
  p.frame({ type: 'chunk', attemptId: 'a', revision: 2, chunk: { type: 'text-delta', text: '失败草稿' } })
  p.frame({ type: 'end', attemptId: 'a', revision: 3, outcome: { eventType: 'assistant/attempt' } })
  assert.equal(receipt.text, '我查查。')
  p.frame({ type: 'start', attemptId: 'b', revision: 4 })
  p.frame({ type: 'chunk', attemptId: 'b', revision: 5, chunk: { type: 'text-delta', text: '找到了。' } })
  p.commit('我查查。\n找到了。')
  assert.equal(receipt.text, '我查查。\n找到了。')
})

test('handoff is bounded text only, excludes tools, maintenance and camera data; source is unchanged', () => {
  const user = text => ({ type: 'user/message', data: { content: [{ type: 'text', text }] } })
  const reply = text => ({ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '秘密思考' }, { type: 'text', text }] } } })
  const events = []
  for (let i = 0; i < 12; i++) events.push(user(`[手机 App · 爸爸] 话题${i}\n[用户本次主动分享的摄像头画面]秘密画面`), reply(`答复${i}`), { type: 'turn/end' })
  events.push(user('[meow-memory-reflect]'), reply('内部整理'), user('电脑任务'), reply('电脑操作'))
  const before = JSON.stringify(events)
  const text = recentMobileContext({ snapshotEvents: () => events })
  assert.ok(text.length <= 3000)
  assert.equal(JSON.parse(text).length, 6)
  assert.match(text, /话题11/)
  assert.doesNotMatch(text, /话题0|秘密|内部|电脑/)
  assert.equal(JSON.stringify(events), before)
  assert.equal(recentMobileContext(null), '')
})
