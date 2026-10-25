// voice.js — 鲸鱼娘的短发声库（只读）。
//
// 素材由 gen/make_voice_clips.py 用**同一套 Edge TTS 原声**（cute=晓伊 / gentle=晓晓）
// 逐音节合成再拼接：笑声、哭声、叹气、撒娇……听感和她说整句话时是同一个声音。
//
// 本文件只读：**不联网、不合成、不写盘**。manifest.json 缺失或损坏时，
// 所有读操作返回 null / []，status() 说明原因，绝不抛。
//
// 用法：
//   const library = createVoiceLibrary({ dir: join(root, 'assets/voice-clips') })
//   library.pick('laugh', 'cute')            // → { name, bytes } | null
//   library.read('laugh_1', 'cute')          // → Buffer | null
//   recordSegment(bytes)                     // → 出站消息段 { type:'record', data:{ file } }

import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** 情绪分组（顺序即展示顺序）。 */
export const CLIP_GROUPS = ['laugh', 'cry', 'sigh', 'happy', 'angry', 'surprise', 'gentle']

/** 清单文件名。 */
export const MANIFEST_FILE = 'manifest.json'

/** 出站语音段：OneBot 的 record 段要求 base64://... */
export function recordSegment(bytes) {
  return { type: 'record', data: { file: `base64://${Buffer.from(bytes).toString('base64')}` } }
}

/**
 * 把清单里的相对 file 收敛成绝对路径；不安全（绝对路径、`..`、空段）返回 null。
 * 这是唯一允许拼路径的地方 —— 清单是数据，不能让它指到素材目录外面去。
 */
function safeClipPath(dir, file) {
  if (typeof file !== 'string' || file === '' || file.includes('\0')) return null
  if (isAbsolute(file)) return null
  const parts = file.split(/[\\/]/)
  if (parts.length === 0) return null
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return null
  }
  const root = resolve(dir)
  const full = resolve(root, file)
  const rel = relative(root, full)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return full
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const { name, label, group, style, file, ms, bytes } = entry
  if (typeof name !== 'string' || name === '') return null
  if (typeof style !== 'string' || style === '') return null
  if (typeof file !== 'string' || file === '') return null
  return {
    name,
    label: typeof label === 'string' ? label : name,
    group: typeof group === 'string' ? group : '',
    style,
    file,
    ms: Number.isFinite(Number(ms)) ? Number(ms) : 0,
    bytes: Number.isFinite(Number(bytes)) ? Number(bytes) : 0,
  }
}

/**
 * 读 `<dir>/manifest.json` 建一个只读库。
 * @param {{ dir?: string, logger?: { warn?: Function } }} options
 */
export function createVoiceLibrary({ dir, logger = console } = {}) {
  const baseDir = resolve(dir ?? join(import.meta.dirname, 'assets', 'voice-clips'))
  const state = { manifest: null, entries: [], groups: {}, error: null }

  const warn = (message) => {
    try {
      if (logger && typeof logger.warn === 'function') logger.warn(`[voice] ${message}`)
    } catch {
      // 日志坏掉不该影响读素材
    }
  }

  function load() {
    let raw
    try {
      raw = readFileSync(join(baseDir, MANIFEST_FILE), 'utf8')
    } catch (error) {
      state.error = error?.code === 'ENOENT' ? 'manifest-missing' : 'manifest-unreadable'
      return
    }
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      state.error = 'manifest-invalid'
      return
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      state.error = 'manifest-invalid'
      return
    }
    if (Number(data.version) !== 1) {
      state.error = `manifest-version:${data.version ?? 'missing'}`
      return
    }
    if (!Array.isArray(data.clips)) {
      state.error = 'manifest-clips'
      return
    }
    const entries = data.clips.map(normalizeEntry).filter(Boolean)
    if (entries.length === 0) {
      state.error = 'manifest-empty'
      return
    }
    const groups = {}
    if (data.groups && typeof data.groups === 'object' && !Array.isArray(data.groups)) {
      for (const [group, names] of Object.entries(data.groups)) {
        if (Array.isArray(names)) groups[group] = names.filter((name) => typeof name === 'string')
      }
    }
    state.manifest = data
    state.entries = entries
    state.groups = groups
  }

  load()
  if (state.error) warn(`${baseDir}: ${state.error}`)

  function styles() {
    const declared = state.manifest?.styles
    if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
      const names = Object.keys(declared)
      if (names.length > 0) return names
    }
    return [...new Set(state.entries.map((entry) => entry.style))]
  }

  function clipNames(group) {
    if (Array.isArray(state.groups[group])) return state.groups[group]
    return [...new Set(state.entries.filter((entry) => entry.group === group).map((e) => e.name))]
  }

  function find(name, style) {
    const wantedStyle = typeof style === 'string' && style !== '' ? style : null
    return (
      state.entries.find(
        (entry) => entry.name === name && (wantedStyle === null || entry.style === wantedStyle),
      ) ?? null
    )
  }

  function list(style) {
    if (state.error) return []
    const wantedStyle = typeof style === 'string' && style !== '' ? style : null
    return state.entries
      .filter((entry) => wantedStyle === null || entry.style === wantedStyle)
      .map(({ name, label, group, style: entryStyle, ms, bytes }) => ({
        name,
        label,
        group,
        style: entryStyle,
        ms,
        bytes,
      }))
  }

  function read(name, style) {
    const entry = find(name, style)
    if (!entry) return null
    const path = safeClipPath(baseDir, entry.file)
    if (!path) {
      warn(`拒绝可疑路径 ${entry.file}（${entry.style}/${entry.name}）`)
      return null
    }
    try {
      return readFileSync(path)
    } catch {
      return null
    }
  }

  function poolFor(nameOrGroup, style) {
    const key = String(nameOrGroup ?? '').trim()
    if (key === '' || state.error) return []
    const wantedStyle = typeof style === 'string' && style !== '' ? style : null
    const byStyle = (entry) => wantedStyle === null || entry.style === wantedStyle
    if (state.entries.some((entry) => entry.name === key)) {
      return state.entries.filter((entry) => entry.name === key && byStyle(entry))
    }
    const names = new Set(clipNames(key))
    return state.entries.filter((entry) => names.has(entry.name) && byStyle(entry))
  }

  /**
   * 按组或按名字挑一个存在的 clip。
   * @param {string} nameOrGroup 组名（laugh/cry/…）或 clip 名
   * @param {string} [style] cute / gentle；省略则不区分声线
   * @param {() => number} [random] 注入随机源，测试用
   * @returns {{ name: string, bytes: Buffer } | null}
   */
  function pick(nameOrGroup, style, random = Math.random) {
    const pool = poolFor(nameOrGroup, style)
    if (pool.length === 0) return null
    let value = 0
    try {
      value = Number(random())
    } catch {
      value = 0
    }
    // random 约定 [0,1)；脏值也不许越界
    const unit = Number.isFinite(value) ? Math.min(0.999999, Math.max(0, value)) : 0
    const entry = pool[Math.floor(unit * pool.length)]
    const bytes = read(entry.name, entry.style)
    return bytes ? { name: entry.name, bytes } : null
  }

  function manifest() {
    return state.manifest ? structuredClone(state.manifest) : null
  }

  function status() {
    const report = {
      available: state.error === null,
      dir: baseDir,
      styles: styles(),
      clips: state.entries.length,
    }
    if (state.error !== null) report.error = state.error
    return report
  }

  return { list, read, pick, manifest, status }
}
