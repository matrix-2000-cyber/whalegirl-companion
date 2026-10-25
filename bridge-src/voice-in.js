// 入站 QQ 语音消息 → 本地 wav → SenseVoice 转写。
// 依赖全部可注入，transcribe 永不抛：失败一律返回 { ok:false, error }。
import { execFile as nodeExecFile } from 'node:child_process'
import { existsSync as nodeExistsSync, mkdtempSync as nodeMkdtempSync, readFileSync as nodeReadFileSync, rmSync as nodeRmSync, writeFileSync as nodeWriteFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as nodeJoin } from 'node:path'

const MAX_ERROR = 120
const MAX_TEXT = 400
const MAX_DOWNLOAD = 32 * 1024 * 1024
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/
const TIMESTAMP = /^\s*\[(\d{1,3}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\]\s*/
const EXEC_OPTIONS = { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }

function asText(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function reasonOf(error) {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : String(error?.message ?? error ?? '未知错误')
  return raw.replace(/\s+/g, ' ').trim() || '未知错误'
}

function bounded(message) {
  const chars = [...String(message)]
  return chars.length <= MAX_ERROR ? chars.join('') : chars.slice(0, MAX_ERROR).join('')
}

// NapCat 的 get_record 只认 uuid：path 是本地 SILK 路径，需取末段文件名兜底。
function basenameId(value) {
  if (!value) return ''
  const normalized = value.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function normalizeRecord(data) {
  const source = data && typeof data === 'object' ? data : {}
  return { file: asText(source.file), path: asText(source.path), url: asText(source.url) }
}

export function splitEmotionTags(text) {
  if (typeof text !== 'string') return { text: '', tags: [] }
  const tags = []
  const stripped = text.replace(/<\|([^|]*)\|>/g, (_, tag) => {
    const value = tag.trim()
    if (value) tags.push(value)
    return ''
  })
  return { text: stripped.trim(), tags }
}

// 逐行去掉 [HH:MM:SS] 前缀、剥离情绪标签、空格拼接，并取最后一条时间戳作为秒数。
function readTranscript(raw) {
  const lines = String(raw ?? '').split(/\r?\n/)
  const pieces = []
  const tags = []
  let seconds = 0
  for (const line of lines) {
    const match = TIMESTAMP.exec(line)
    const body = match ? line.slice(match[0].length) : line
    if (match) {
      const [, first, second, third] = match
      const total = third === undefined
        ? Number(first) * 60 + Number(second)
        : Number(first) * 3600 + Number(second) * 60 + Number(third)
      if (Number.isFinite(total) && total > seconds) seconds = total
    }
    const split = splitEmotionTags(body)
    if (split.text) pieces.push(split.text)
    if (split.tags.length) tags.push(...split.tags)
  }
  return {
    text: [...pieces.join(' ').trim()].slice(0, MAX_TEXT).join(''),
    tags,
    seconds: Math.round(seconds),
  }
}

export function createVoiceTranscriber({
  call,
  execFile = nodeExecFile,
  existsSync = nodeExistsSync,
  readFileSync = nodeReadFileSync,
  writeFileSync = nodeWriteFileSync,
  mkdtempSync = nodeMkdtempSync,
  rmSync = nodeRmSync,
  join = nodeJoin,
  root,
  python,
  asrScript,
  logger = console,
  timeoutMs = 60000,
  fetchImpl,
} = {}) {
  const run = (command, args, signal) => execFile(command, args, {
    ...EXEC_OPTIONS,
    timeout: timeoutMs,
    ...(signal ? { signal } : {}),
  })

  function materialize(record, dir) {
    const payload = record && typeof record === 'object' && record.data && typeof record.data === 'object'
      ? record.data
      : record
    const file = asText(payload?.file)
    if (file) return file
    const base64 = asText(payload?.base64)
    if (!base64) return ''
    const encoded = base64.replace(/^data:[^,]*,/i, '').replace(/^base64:\/\//i, '')
    const target = join(dir, 'record.wav')
    writeFileSync(target, Buffer.from(encoded, 'base64'))
    return target
  }

  async function download(url, target, signal) {
    const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
    if (typeof fetchFn !== 'function') throw new Error('当前环境不支持下载')
    const response = await fetchFn(url, { signal })
    if (!response?.ok) throw new Error(`下载语音失败 HTTP ${response?.status ?? '?'}`)
    const chunks = []
    let size = 0
    for await (const chunk of response.body ?? []) {
      const buffer = Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_DOWNLOAD) throw new Error('语音文件超过 32MB')
      chunks.push(buffer)
    }
    writeFileSync(target, Buffer.concat(chunks))
  }

  async function fallbackWav({ path, url, dir, signal, recordError }) {
    let source = ''
    if (path && ABSOLUTE_PATH.test(path) && existsSync(path)) source = path
    if (!source && url && /^https?:\/\//i.test(url)) {
      source = join(dir, 'record.download')
      await download(url, source, signal)
    }
    if (!source) throw new Error(recordError ? `无法获取语音文件：${recordError}` : '找不到可用的语音文件')
    const wav = join(dir, 'voice.wav')
    await run('ffmpeg', ['-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', wav], signal)
    if (!existsSync(wav)) throw new Error('ffmpeg 未能生成 wav')
    return wav
  }

  async function transcribe(data, options = {}) {
    const signal = options?.signal
    let dir = ''
    try {
      signal?.throwIfAborted?.()
      const { file, path, url } = normalizeRecord(data)
      const source = data && typeof data === 'object' ? data : {}
      // 实测：get_record 只接受 data.file 里的 uuid；再退化到 path 的末段文件名和 file_id。
      const recordId = file || basenameId(path) || asText(source.file_id)
      if (!recordId && !path && !url) throw new Error('语音消息缺少 file/path/url')
      const base = root ?? join(tmpdir(), 'qq-bridge-voice')
      dir = mkdtempSync(join(base, 'vin-'))
      signal?.throwIfAborted?.()
      let wav = ''
      let recordError = ''
      if (recordId) {
        try {
          const record = await call('get_record', { file: recordId, out_format: 'wav' })
          wav = materialize(record, dir)
          if (!wav) throw new Error('get_record 未返回音频文件')
          if (!existsSync(wav)) throw new Error('get_record 返回的音频文件不存在')
        } catch (error) {
          recordError = reasonOf(error)
          wav = ''
        }
      }
      if (!wav) wav = await fallbackWav({ path, url, dir, signal, recordError })
      const txt = join(dir, 'asr.txt')
      await run(python, [asrScript, '--wav', wav, '--out', txt], signal)
      if (!existsSync(txt)) throw new Error('语音转写没有输出')
      const read = readFileSync(txt, 'utf8')
      const { text, tags, seconds } = readTranscript(read)
      return { ok: true, text, tags, seconds }
    } catch (error) {
      const reason = `语音转写失败：${reasonOf(error)}`
      try { logger?.warn?.(reason) } catch {}
      return { ok: false, error: bounded(reason) }
    } finally {
      if (dir) {
        try { rmSync(dir, { recursive: true, force: true }) } catch {}
      }
    }
  }

  return { transcribe }
}
