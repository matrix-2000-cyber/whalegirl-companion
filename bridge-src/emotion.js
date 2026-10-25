// 轻量中文情绪识别：纯函数、无 I/O、无外部依赖。
// 目标不是“读懂”，而是宁可漏判也别乱判：只有分值够高、线索明确时才给提示。

const MAX_TEXT = 200
const MAX_CUES = 6
const CONFIDENT_SCORE = 2.4
const CONFIDENT_MARGIN = 0.5
const LABELS = ['happy', 'sad', 'cry', 'angry', 'tired', 'anxious']

const blank = () => ({ label: 'neutral', intensity: 0, cues: [], confident: false })

// 否定词 + 最多一个程度副词，如「不太开心」「一点都不开心」。
const NEGATION = /(?:不|没|别|无|未|甭|莫)(?:太|怎么|很|是|要|用|想|会|能|再|都|也|那么|这么)?$/

function negatedAt(text, index) {
  return NEGATION.test(text.slice(Math.max(0, index - 4), index))
}

// 重复字单独加权：哈/嘿/嘻 是笑，呜 是哭，唉 是叹气，哼 是不满。
const REPEATED = [
  { re: /哈{2,}/g, label: 'happy', base: 2.4, step: 0.6, max: 4.5 },
  { re: /嘿{2,}/g, label: 'happy', base: 2.4, step: 0.5, max: 4.0 },
  { re: /嘻{2,}/g, label: 'happy', base: 2.4, step: 0.5, max: 4.0 },
  { re: /呜{2,}/g, label: 'cry', base: 2.8, step: 0.6, max: 4.5 },
  { re: /唉{2,}/g, label: 'tired', base: 2.4, step: 0.5, max: 4.0 },
]
const HENG = /哼+/g

// 中文词表。同一类可以有多条规则，命中会累加。
const RULES = [
  { label: 'happy', re: /开心|高兴|快乐|愉快|兴奋|幸福|美滋滋|好耶|太好|真棒|棒极了|舒服|爽|喜欢|爱了|满足|得意/g, w: 2.6 },
  { label: 'happy', re: /笑死|笑疯|笑喷/g, w: 3.2 },

  { label: 'sad', re: /难过|伤心|委屈|失落|沮丧|郁闷|难受|心酸|孤独|寂寞|绝望|低落|想哭/g, w: 3.0 },
  { label: 'sad', re: /笑不出来|笑不出|高兴不起来|开心不起来/g, w: 3.0 },

  // 「想哭」归 sad，避免和 cry 互相抢分。
  { label: 'cry', re: /(?<!想)哭|泪|抽泣|哽咽|啜泣/g, w: 2.6 },

  { label: 'angry', re: /气死|气炸|愤怒|火大|恼火|烦死/g, w: 3.0 },
  { label: 'angry', re: /生气|发火|受够|气人|讨厌|闭嘴/g, w: 2.6 },
  { label: 'angry', re: /烦/g, w: 2.4 },

  { label: 'tired', re: /没睡好|没睡够|睡不好|睡不着|失眠|熬夜|加班|疲惫|疲倦|乏力|撑不住|叹气/g, w: 3.0 },
  { label: 'tired', re: /(?<![积计])累/g, w: 3.0 },
  { label: 'tired', re: /困了|好困|太困|困死|困得|犯困/g, w: 2.8 },
  { label: 'tired', re: /唉/g, w: 1.8 },

  { label: 'anxious', re: /慌|紧张|焦虑|担心|不安|害怕|着急|心慌|忐忑|急死|发愁/g, w: 2.8 },
  { label: 'anxious', re: /压力大|压力好大|有压力|压力山大/g, w: 2.8 },
]

// emoji 直接映射，不参与否定判断。
const EMOJI = [
  ['😭', 'cry', 4.0],
  ['😢', 'sad', 3.2],
  ['😂', 'happy', 3.2],
  ['😄', 'happy', 3.0],
  ['😊', 'happy', 2.8],
  ['😡', 'angry', 3.8],
  ['😩', 'tired', 3.2],
  ['😮‍💨', 'tired', 3.6],
  ['🥲', 'sad', 2.8],
  ['😞', 'sad', 3.2],
  ['😤', 'angry', 3.0],
]

// 只有形容词性的开心被否定时才翻成难过；「别笑」「不喜欢」不算难过。
const NEGATED_HAPPY = /^(?:开心|高兴|快乐|愉快|兴奋|幸福|美滋滋|满足|得意|舒服|爽|喜欢)$/

export function detectEmotion(text, opts = {}) {
  if (typeof text !== 'string') return blank()
  const raw = text.trim()
  if (!raw) return blank()
  const limit = Number.isFinite(opts?.maxLength) && opts.maxLength > 0 ? Math.floor(opts.maxLength) : MAX_TEXT
  const input = [...raw].slice(0, limit).join('')
  const scores = Object.fromEntries(LABELS.map(label => [label, 0]))
  const cues = []
  const hit = (label, weight, cue) => {
    if (!LABELS.includes(label) || !(weight > 0)) return
    scores[label] += weight
    if (cue && cues.length < 24 && !cues.includes(cue)) cues.push(cue)
  }

  for (const rule of REPEATED) {
    for (const match of input.matchAll(rule.re)) {
      if (negatedAt(input, match.index ?? 0)) continue
      hit(rule.label, Math.min(rule.max, rule.base + rule.step * (match[0].length - 2)), match[0].slice(0, 8))
    }
  }
  for (const match of input.matchAll(HENG)) {
    if (negatedAt(input, match.index ?? 0)) continue
    const weight = match[0].length > 1 ? Math.min(3.6, 2.4 + 0.5 * (match[0].length - 1)) : 2.0
    hit('angry', weight, match[0].slice(0, 8))
  }
  for (const rule of RULES) {
    for (const match of input.matchAll(rule.re)) {
      const index = match.index ?? 0
      const word = match[0]
      if (negatedAt(input, index)) {
        if (rule.label === 'happy' && NEGATED_HAPPY.test(word)) hit('sad', rule.w, '不' + word.slice(0, 10))
        continue
      }
      hit(rule.label, rule.w, word.slice(0, 12))
    }
  }
  for (const [emoji, label, weight] of EMOJI) if (input.includes(emoji)) hit(label, weight, emoji)

  const exclaims = (input.match(/[!！]/g) ?? []).length
  const questions = (input.match(/[?？]/g) ?? []).length
  const ellipsis = /(?:…|\.{3,}|。{3,})/.test(input)
  const factor = 1 + Math.min(exclaims, 3) * 0.12 + Math.min(questions, 2) * 0.05 + (ellipsis ? 0.08 : 0)

  const ranked = LABELS.map(label => [label, scores[label]]).sort((a, b) => b[1] - a[1])
  const [topLabel, topScore] = ranked[0]
  if (!(topScore > 0)) return blank()
  const boosted = topScore * factor
  const second = ranked[1]?.[1] ?? 0
  return {
    label: topLabel,
    intensity: Math.max(1, Math.min(5, Math.ceil(boosted))),
    cues: cues.slice(0, MAX_CUES),
    confident: boosted >= CONFIDENT_SCORE && topScore >= second + CONFIDENT_MARGIN,
  }
}

const HINTS = {
  happy: who => `（${who}心情好 · 可以一起开心，别泼冷水）`,
  sad: who => `（${who}有点难过 · 先安抚，别讲道理，别玩梗）`,
  cry: who => `（${who}有点难过 · 先安抚，别讲道理，别玩梗）`,
  angry: who => `（${who}在气头上 · 先顺着情绪，别辩解，别开玩笑）`,
  tired: who => `（${who}累了 · 少提问，话短一点，安静陪着）`,
  anxious: who => `（${who}有点慌 · 语气稳一点，先给确定感）`,
}

export function emotionHint(result, { who = '爸爸' } = {}) {
  if (!result || result.confident !== true || !LABELS.includes(result.label)) return null
  const build = HINTS[result.label]
  if (!build) return null
  const raw = typeof who === 'string' ? who.trim() : ''
  const name = raw ? [...raw].slice(0, 8).join('').replace(/[()（）"'`“”‘’「」『』\r\n]/g, '') : ''
  const hint = build(name || '爸爸')
  return [...hint].slice(0, 40).join('')
}

// SenseVoice 的强事件标签（Laughter/Cry/Sigh）优先于文本通道。
const STRONG_TAGS = new Map([
  ['laughter', ['happy', 4, 'Laughter']],
  ['laughing', ['happy', 4, 'Laughter']],
  ['laugh', ['happy', 4, 'Laughter']],
  ['cry', ['cry', 4, 'Cry']],
  ['crying', ['cry', 4, 'Cry']],
  ['sob', ['cry', 4, 'Cry']],
  ['sobbing', ['cry', 4, 'Cry']],
  ['sigh', ['tired', 4, 'Sigh']],
  ['sighs', ['tired', 4, 'Sigh']],
  ['sighing', ['tired', 4, 'Sigh']],
])
const EMOTION_TAGS = new Map([
  ['happy', ['happy', 3]],
  ['joy', ['happy', 3]],
  ['sad', ['sad', 3]],
  ['sorrow', ['sad', 3]],
  ['angry', ['angry', 3]],
  ['anger', ['angry', 3]],
  ['tired', ['tired', 3]],
  ['anxious', ['anxious', 3]],
  ['fear', ['anxious', 3]],
  ['fearful', ['anxious', 3]],
])
const ACOUSTIC_ORDER = ['cry', 'angry', 'sad', 'anxious', 'tired', 'happy']
const STRONG_CUE = /^(?:laughter|laugh|laughing|cry|crying|sob|sobbing|sigh|sighs|sighing)$/i

function tagTokens(tags) {
  const tokens = []
  const add = value => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    const tagged = [...trimmed.matchAll(/<\|([^|]*)\|>/g)].map(match => match[1].trim()).filter(Boolean)
    if (tagged.length) tokens.push(...tagged)
    else tokens.push(...trimmed.split(/[\s,，、]+/).filter(Boolean))
  }
  if (Array.isArray(tags)) for (const item of tags) add(item)
  else add(tags)
  return tokens
}

export function acousticEmotion(tags) {
  const scores = Object.fromEntries(LABELS.map(label => [label, 0]))
  const cues = []
  for (const token of tagTokens(tags)) {
    const key = token.toLowerCase()
    if (key === 'neutral') continue
    const strong = STRONG_TAGS.get(key)
    if (strong) {
      scores[strong[0]] += strong[1]
      if (!cues.includes(strong[2])) cues.push(strong[2])
      continue
    }
    const emotion = EMOTION_TAGS.get(key)
    if (!emotion) continue
    scores[emotion[0]] += emotion[1]
    const cue = key.toUpperCase()
    if (!cues.includes(cue)) cues.push(cue)
  }
  const ranked = LABELS.map(label => [label, scores[label]]).sort((a, b) => b[1] - a[1] ||
    ACOUSTIC_ORDER.indexOf(a[0]) - ACOUSTIC_ORDER.indexOf(b[0]))
  const [label, score] = ranked[0]
  if (!(score > 0)) return blank()
  return {
    label,
    intensity: Math.max(1, Math.min(5, Math.ceil(score))),
    cues: cues.slice(0, MAX_CUES),
    confident: true,
  }
}

function saneResult(value) {
  if (!value || typeof value !== 'object' || !LABELS.includes(value.label)) return blank()
  return {
    label: value.label,
    intensity: Number.isFinite(value.intensity) ? Math.max(0, Math.min(5, Math.round(value.intensity))) : 0,
    cues: Array.isArray(value.cues) ? value.cues.slice(0, MAX_CUES).map(String) : [],
    confident: value.confident === true,
  }
}

export function mergeEmotion(textResult, acousticResult) {
  const text = saneResult(textResult)
  const acoustic = saneResult(acousticResult)
  const textOk = text.confident && text.label !== 'neutral'
  const acousticOk = acoustic.confident && acoustic.label !== 'neutral'
  const strong = acousticOk && acoustic.cues.some(cue => STRONG_CUE.test(cue.trim()))
  if (strong) return acoustic
  if (textOk && acousticOk) return acoustic.intensity > text.intensity ? acoustic : text
  if (textOk) return text
  if (acousticOk) return acoustic
  return acoustic.intensity > text.intensity ? acoustic : text
}
