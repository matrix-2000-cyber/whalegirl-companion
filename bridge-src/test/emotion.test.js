import test from 'node:test'
import assert from 'node:assert/strict'
import { detectEmotion, emotionHint, acousticEmotion, mergeEmotion } from '../emotion.js'

const NEUTRAL = { label: 'neutral', intensity: 0, cues: [], confident: false }

test('六类中文情绪都能识别，并给出 1..5 的强度', () => {
  const cases = [
    ['今天真的好开心，太幸福了', 'happy'],
    ['最近有点难过，心里空空的', 'sad'],
    ['呜呜呜，我真的哭了', 'cry'],
    ['气死我了！！', 'angry'],
    ['唉……今天好累', 'tired'],
    ['我有点慌，不知道怎么办', 'anxious'],
  ]
  for (const [text, label] of cases) {
    const result = detectEmotion(text)
    assert.equal(result.label, label, text)
    assert.equal(result.confident, true, text)
    assert.ok(Number.isInteger(result.intensity) && result.intensity >= 1 && result.intensity <= 5, text)
    assert.ok(result.cues.length > 0 && result.cues.length <= 6, text)
  }
})

test('常见 emoji 直接映射到对应情绪', () => {
  const cases = [
    ['😭', 'cry'], ['😢', 'sad'], ['😂', 'happy'], ['😄', 'happy'], ['😊', 'happy'],
    ['😡', 'angry'], ['😩', 'tired'], ['😮‍💨', 'tired'], ['🥲', 'sad'], ['😞', 'sad'], ['😤', 'angry'],
  ]
  for (const [text, label] of cases) {
    const result = detectEmotion(`今天${text}`)
    assert.equal(result.label, label, text)
    assert.equal(result.confident, true, text)
  }
})

test('任务书里的典型句子都落在正确标签上', () => {
  assert.equal(detectEmotion('唉……今天好累').label, 'tired')
  assert.equal(detectEmotion('气死我了！！').label, 'angry')
  assert.equal(detectEmotion('呜呜呜').label, 'cry')
  assert.equal(detectEmotion('笑死我了').label, 'happy')
  assert.equal(detectEmotion('好耶！').label, 'happy')
  assert.equal(detectEmotion('我有点慌').label, 'anxious')
})

test('否定和反讽不会给反方向提示', () => {
  assert.equal(detectEmotion('不开心').label, 'sad')
  assert.equal(detectEmotion('不开心').confident, true)
  assert.equal(detectEmotion('不生气').label, 'neutral')
  assert.equal(detectEmotion('不生气').confident, false)
  assert.equal(detectEmotion('笑不出来').label, 'sad')
  assert.equal(detectEmotion('没睡好').label, 'tired')
  assert.notEqual(detectEmotion('别哭').label, 'cry')
  assert.equal(detectEmotion('别哭').label, 'neutral')
  for (const text of ['我没事', '还好']) {
    assert.equal(detectEmotion(text).label, 'neutral', text)
    assert.equal(detectEmotion(text).confident, false, text)
  }
})

test('日常寒暄和问句不产生情绪提示', () => {
  for (const text of ['在吗', '吃饭了吗', '今天天气不错', '这是什么', '帮我查一下']) {
    const result = detectEmotion(text)
    assert.equal(result.label, 'neutral', text)
    assert.equal(result.confident, false, text)
    assert.equal(emotionHint(result), null, text)
  }
  // 例外：连续的「哈」就是笑，允许给出确定提示。
  assert.equal(detectEmotion('哈哈哈').label, 'happy')
  assert.equal(detectEmotion('哈哈哈').confident, true)
})

test('重复字、感叹号和强度随线索累积', () => {
  assert.equal(detectEmotion('哼').confident, false)
  assert.equal(detectEmotion('哼').label, 'angry')
  assert.equal(detectEmotion('哼哼').confident, true)
  assert.equal(detectEmotion('哼哼').label, 'angry')
  assert.equal(detectEmotion('哈').label, 'neutral')
  assert.equal(detectEmotion('嘿嘿').label, 'happy')
  assert.equal(detectEmotion('嘻嘻').label, 'happy')
  assert.equal(detectEmotion('唉唉').label, 'tired')
  assert.ok(detectEmotion('气死我了！！！').intensity > detectEmotion('今天有点烦').intensity)
  assert.ok(detectEmotion('呜呜呜').intensity >= detectEmotion('呜呜').intensity)
  assert.ok(detectEmotion('哈哈哈哈哈').intensity >= detectEmotion('哈哈').intensity)
  const result = detectEmotion('气死我了')
  assert.ok(result.intensity >= 1 && result.intensity <= 5)
  assert.equal(detectEmotion('难过 伤心 委屈 想哭 呜呜呜 哭个不停').intensity, 5)
})

test('只分析前 200 字，并容忍非字符串', () => {
  const hidden = '在吗'.repeat(120) + '气死我了'
  assert.equal(detectEmotion(hidden).label, 'neutral')
  const visible = '唉……今天好累' + '好'.repeat(500)
  assert.equal(detectEmotion(visible).label, 'tired')
  for (const value of [null, undefined, 42, true, [], {}, '   ']) {
    assert.deepEqual(detectEmotion(value), NEUTRAL)
  }
})

test('emotionHint 只在确定情绪时给一句短提示', () => {
  assert.equal(emotionHint(detectEmotion('呜呜呜')), '（爸爸有点难过 · 先安抚，别讲道理，别玩梗）')
  assert.equal(
    emotionHint(detectEmotion('气死我了！！'), { who: '妈妈' }),
    '（妈妈在气头上 · 先顺着情绪，别辩解，别开玩笑）',
  )
  for (const text of ['在吗', '不生气', '别哭', '我没事', '还好']) {
    assert.equal(emotionHint(detectEmotion(text)), null, text)
  }
  for (const label of ['happy', 'sad', 'cry', 'angry', 'tired', 'anxious']) {
    const hint = emotionHint({ label, intensity: 3, cues: [], confident: true }, { who: '爸爸'.repeat(20) })
    assert.equal(typeof hint, 'string')
    assert.ok([...hint].length <= 40, hint)
    assert.ok(!/[\r\n"'“”]/.test(hint), hint)
    assert.ok(hint.startsWith('（') && hint.endsWith('）'), hint)
  }
  assert.equal(emotionHint({ label: 'sad', intensity: 3, cues: [], confident: false }), null)
  assert.equal(emotionHint({ label: 'neutral', intensity: 0, cues: [], confident: true }), null)
  assert.equal(emotionHint({ label: 'weird', intensity: 3, cues: [], confident: true }), null)
  assert.equal(emotionHint(null), null)
})

test('acousticEmotion 解析 SenseVoice 的标签和裸词', () => {
  assert.equal(acousticEmotion('<|Laughter|>').label, 'happy')
  assert.equal(acousticEmotion(['<|Cry|>']).label, 'cry')
  assert.equal(acousticEmotion('<|Sigh|>').label, 'tired')
  assert.equal(acousticEmotion('<|HAPPY|>').label, 'happy')
  assert.equal(acousticEmotion('<|SAD|>').label, 'sad')
  assert.equal(acousticEmotion('<|ANGRY|>').label, 'angry')
  assert.equal(acousticEmotion('laughter').label, 'happy')
  assert.equal(acousticEmotion('Sigh').label, 'tired')
  const neutral = acousticEmotion('<|NEUTRAL|>')
  assert.equal(neutral.label, 'neutral')
  assert.equal(neutral.confident, false)
  for (const value of [undefined, null, '', [], '<|Speech|>', '<|BGM|>', 42, {}]) {
    assert.deepEqual(acousticEmotion(value), NEUTRAL)
  }
  const mixed = acousticEmotion('<|zh|><|Laughter|><|Speech|>')
  assert.equal(mixed.label, 'happy')
  assert.ok(mixed.cues.includes('Laughter'))
  assert.ok(mixed.cues.length <= 6)
})

test('mergeEmotion 让 Laughter/Cry/Sigh 强线索优先，其余取更确定的一侧', () => {
  const laugh = acousticEmotion('<|Laughter|>')
  assert.equal(mergeEmotion(detectEmotion('在吗'), laugh).label, 'happy')
  assert.equal(mergeEmotion(detectEmotion('气死我了！！'), acousticEmotion('<|Sigh|>')).label, 'tired')
  assert.equal(mergeEmotion(detectEmotion('在吗'), { label: 'cry', intensity: 4, cues: ['Cry'], confident: true }).label, 'cry')

  const text = { label: 'happy', intensity: 5, cues: ['开心'], confident: true }
  const tagged = acousticEmotion('<|HAPPY|>')
  assert.equal(mergeEmotion(text, tagged).label, 'happy')
  assert.equal(mergeEmotion(text, tagged).intensity, 5)
  assert.equal(mergeEmotion(detectEmotion('在吗'), tagged).label, 'happy')

  assert.equal(mergeEmotion(detectEmotion('在吗'), acousticEmotion('')).label, 'neutral')
  assert.equal(mergeEmotion(null, null).label, 'neutral')
  assert.equal(mergeEmotion({ label: 'sad', intensity: 2, cues: [], confident: true }, null).label, 'sad')
})
