import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createVoiceTranscriber, normalizeRecord, splitEmotionTags } from '../voice-in.js'

const ROOT = 'D:\\fake\\voice-root'
const WAV = 'C:\\fake\\cache\\record.wav'

// 全部依赖注入：不读写真实文件、不联网、不跑 ASR。
function harness(options = {}) {
  const {
    record = { file: WAV },
    recordError,
    files = [WAV],
    asrText = '[00:00:01] 在吗',
    writeAsr = true,
    readError,
    mkdtempError,
    rmError,
    fetchImpl,
    execFileFailure,
  } = options
  const calls = []
  const execs = []
  const made = []
  const removed = []
  const writes = []
  const warnings = []
  const fileSet = new Set(files)
  const contents = new Map()
  let sequence = 0

  const existsSync = path => fileSet.has(path)
  const readFileSync = (path, encoding) => {
    if (readError) throw readError
    if (!contents.has(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return contents.get(path)
  }
  const writeFileSync = (path, data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
    writes.push({ path, bytes: buffer.length })
    fileSet.add(path)
    contents.set(path, buffer)
  }
  const mkdtempSync = prefix => {
    if (mkdtempError) throw mkdtempError
    const dir = `${prefix}${++sequence}`
    made.push(dir)
    return dir
  }
  const rmSync = dir => {
    removed.push(dir)
    if (rmError) throw rmError
    for (const path of [...fileSet]) if (path.startsWith(dir)) fileSet.delete(path)
    for (const path of [...contents.keys()]) if (path.startsWith(dir)) contents.delete(path)
  }
  const call = async (action, params) => {
    calls.push({ action, params })
    if (recordError) throw recordError
    return record
  }
  const execFile = async (command, args, execOptions) => {
    execs.push({ command, args, options: execOptions })
    const failure = typeof execFileFailure === 'function' ? execFileFailure(command, args) : null
    if (failure) throw failure
    if (command === 'ffmpeg') {
      const output = args.at(-1)
      fileSet.add(output)
      contents.set(output, 'RIFF')
      return { stdout: '', stderr: '' }
    }
    if (command === 'mock-python' && writeAsr) {
      const output = args[args.indexOf('--out') + 1]
      fileSet.add(output)
      contents.set(output, asrText)
    }
    return { stdout: '', stderr: '' }
  }
  const logger = { warn: (...args) => warnings.push(args.join(' ')) }
  const transcriber = createVoiceTranscriber({
    call,
    execFile,
    existsSync,
    readFileSync,
    writeFileSync,
    mkdtempSync,
    rmSync,
    join,
    root: ROOT,
    python: 'mock-python',
    asrScript: 'D:\\fake\\meet_asr.py',
    logger,
    timeoutMs: 12345,
    fetchImpl,
  })
  return { transcriber, calls, execs, made, removed, writes, warnings, files: fileSet, contents }
}

test('正常路径：get_record → ASR → 文本/标签/时长', async () => {
  const kit = harness({
    record: { file: WAV },
    files: [WAV],
    asrText: '[00:00:01] 今天好累\r\n[00:00:03] <|Sigh|>唉……\n',
  })
  const result = await kit.transcriber.transcribe({
    file: 'uuid-1',
    path: 'C:\\fake\\Ori\\hash',
    url: 'https://example.invalid/voice.amr',
  })
  assert.deepEqual(result, { ok: true, text: '今天好累 唉……', tags: ['Sigh'], seconds: 3 })
  assert.deepEqual(kit.calls, [{ action: 'get_record', params: { file: 'uuid-1', out_format: 'wav' } }])
  assert.equal(kit.execs.length, 1)
  assert.equal(kit.execs[0].command, 'mock-python')
  assert.deepEqual(kit.execs[0].args.slice(0, 4), ['D:\\fake\\meet_asr.py', '--wav', WAV, '--out'])
  assert.equal(kit.execs[0].options.timeout, 12345)
  assert.equal(kit.execs[0].options.windowsHide, true)
  assert.equal(kit.execs[0].options.maxBuffer, 4 * 1024 * 1024)
  assert.equal(kit.made.length, 1)
  assert.ok(kit.made[0].startsWith(join(ROOT, 'vin-')))
  assert.deepEqual(kit.removed, kit.made)
})

test('get_record 的 id 优先 file，退化到 path 末段文件名和 file_id', async () => {
  const kit = harness({ record: { file: 'C:\\fake\\cache\\abc123.wav' }, files: ['C:\\fake\\cache\\abc123.wav'] })
  const result = await kit.transcriber.transcribe({ path: 'C:\\fake\\Ori\\abc123.silk' })
  assert.equal(result.ok, true)
  assert.deepEqual(kit.calls[0].params, { file: 'abc123', out_format: 'wav' })

  const byFileId = harness({ record: { file: 'C:\\fake\\cache\\fid.wav' }, files: ['C:\\fake\\cache\\fid.wav'] })
  assert.equal((await byFileId.transcriber.transcribe({ file_id: 'fid' })).ok, true)
  assert.deepEqual(byFileId.calls[0].params, { file: 'fid', out_format: 'wav' })
})

test('get_record 返回 base64 时落盘后再转写', async () => {
  const kit = harness({
    record: { base64: Buffer.from('fake-wav').toString('base64') },
    asrText: '[00:00:02] 你好',
  })
  const result = await kit.transcriber.transcribe({ file: 'uuid-b64' })
  assert.equal(result.ok, true)
  assert.equal(result.text, '你好')
  assert.equal(result.seconds, 2)
  assert.equal(kit.writes.length, 1)
  assert.equal(kit.writes[0].bytes, 8)
  assert.ok(kit.writes[0].path.endsWith('record.wav'))
  assert.deepEqual(kit.removed, kit.made)
})

test('get_record 失败时回退到 path 的本地文件并转 16k 单声道 wav', async () => {
  const local = 'C:\\fake\\Ori\\deadbeef'
  const kit = harness({ recordError: new Error('get_record timeout'), files: [local], asrText: '[00:00:01] 气死我了' })
  const result = await kit.transcriber.transcribe({
    file: 'uuid-2',
    path: local,
    url: 'https://example.invalid/voice.amr',
  })
  assert.equal(result.ok, true)
  assert.equal(kit.calls[0].params.file, 'uuid-2')
  assert.equal(kit.execs.length, 2)
  assert.equal(kit.execs[0].command, 'ffmpeg')
  assert.deepEqual(kit.execs[0].args.slice(0, -1), ['-y', '-i', local, '-vn', '-ac', '1', '-ar', '16000'])
  assert.ok(kit.execs[0].args.at(-1).startsWith(kit.made[0]))
  assert.equal(kit.execs[1].command, 'mock-python')
  assert.deepEqual(kit.removed, kit.made)
})

test('get_record 返回的 wav 不存在时同样回退本地 path', async () => {
  const local = 'C:\\fake\\Ori\\deadbeef'
  const kit = harness({
    record: { file: 'C:\\fake\\cache\\missing.wav' },
    files: [local],
  })
  const result = await kit.transcriber.transcribe({ file: 'uuid-3', path: local })
  assert.equal(result.ok, true)
  assert.equal(kit.execs[0].command, 'ffmpeg')
  assert.equal(kit.execs[0].args[2], local)
  assert.deepEqual(kit.removed, kit.made)
})

test('get_record 失败且本地文件不存在时下载 url 再转写', async () => {
  const fetched = []
  const fetchImpl = async (url, fetchOptions) => {
    fetched.push({ url, options: fetchOptions })
    return {
      ok: true,
      status: 200,
      body: (async function* () { yield Buffer.from('amr-bytes') })(),
    }
  }
  const kit = harness({ recordError: new Error('no record'), fetchImpl })
  const result = await kit.transcriber.transcribe({
    file: 'uuid-4',
    path: 'C:\\fake\\missing.silk',
    url: 'https://example.invalid/voice.amr',
  })
  assert.equal(result.ok, true)
  assert.equal(fetched.length, 1)
  assert.equal(fetched[0].url, 'https://example.invalid/voice.amr')
  assert.ok(kit.writes.some(write => write.path.endsWith('record.download')))
  assert.equal(kit.execs[0].command, 'ffmpeg')
  assert.deepEqual(kit.removed, kit.made)
})

test('ASR 没有产出 txt 时返回 ok:false，错误不超过 120 字', async () => {
  const kit = harness({ record: { file: WAV }, files: [WAV], writeAsr: false })
  const result = await kit.transcriber.transcribe({ file: 'uuid-5' })
  assert.equal(result.ok, false)
  assert.match(result.error, /^语音转写失败：/)
  assert.match(result.error, /没有输出/)
  assert.ok([...result.error].length <= 120)
  assert.deepEqual(kit.removed, kit.made)
})

test('ASR 崩溃时返回 ok:false，不向外抛', async () => {
  const kit = harness({
    record: { file: WAV },
    files: [WAV],
    execFileFailure: command => command === 'mock-python' ? new Error('sensevoice exploded') : null,
  })
  const result = await kit.transcriber.transcribe({ file: 'uuid-6' })
  assert.equal(result.ok, false)
  assert.match(result.error, /^语音转写失败：/)
  assert.match(result.error, /sensevoice exploded/)
  assert.ok([...result.error].length <= 120)
  assert.deepEqual(kit.removed, kit.made)
})

test('缺少 file/path/url 时直接失败，不建临时目录', async () => {
  const kit = harness()
  for (const data of [null, undefined, {}, '', '   ', { file: '   ', path: null }]) {
    const result = await kit.transcriber.transcribe(data)
    assert.equal(result.ok, false)
    assert.ok([...result.error].length <= 120)
  }
  assert.equal(kit.made.length, 0)
  assert.equal(kit.calls.length, 0)
  assert.equal(kit.execs.length, 0)
})

test('永不抛：mkdtemp/rm/read 失败都是受控结果，AbortSignal 生效', async () => {
  const broken = harness({ mkdtempError: new Error('temp unavailable') })
  assert.equal((await broken.transcriber.transcribe({ file: 'uuid' })).ok, false)
  assert.equal(broken.removed.length, 0)

  const rmBad = harness({ record: { file: WAV }, files: [WAV], rmError: new Error('locked') })
  assert.equal((await rmBad.transcriber.transcribe({ file: 'uuid' })).ok, true)
  assert.equal(rmBad.removed.length, 1)

  const readBad = harness({ record: { file: WAV }, files: [WAV], readError: new Error('txt unreadable') })
  const readResult = await readBad.transcriber.transcribe({ file: 'uuid' })
  assert.equal(readResult.ok, false)
  assert.match(readResult.error, /txt unreadable/)

  const controller = new AbortController()
  controller.abort()
  const aborted = harness()
  const abortResult = await aborted.transcriber.transcribe({ file: 'uuid-abort' }, { signal: controller.signal })
  assert.equal(abortResult.ok, false)
  assert.equal(aborted.calls.length, 0)

  await assert.doesNotReject(aborted.transcriber.transcribe(undefined, null))
})

test('正文截断到 400 字，情绪标签不进入正文，无时间戳时秒数为 0', async () => {
  const long = harness({
    record: { file: WAV },
    files: [WAV],
    asrText: '[00:00:01] <|HAPPY|>' + '鱼'.repeat(500),
  })
  const result = await long.transcriber.transcribe({ file: 'uuid-long' })
  assert.equal(result.ok, true)
  assert.equal([...result.text].length, 400)
  assert.deepEqual(result.tags, ['HAPPY'])
  assert.equal(result.seconds, 1)

  const noTime = harness({
    record: { file: WAV },
    files: [WAV],
    asrText: '<|Cry|>呜呜\n第二行',
  })
  const second = await noTime.transcriber.transcribe({ file: 'uuid-notime' })
  assert.deepEqual(second, { ok: true, text: '呜呜 第二行', tags: ['Cry'], seconds: 0 })
})

test('normalizeRecord 与 splitEmotionTags 的纯函数行为', () => {
  assert.deepEqual(normalizeRecord(null), { file: '', path: '', url: '' })
  assert.deepEqual(normalizeRecord(undefined), { file: '', path: '', url: '' })
  assert.deepEqual(
    normalizeRecord({ file: '  C:\\a.wav  ', path: 42, url: null }),
    { file: 'C:\\a.wav', path: '42', url: '' },
  )
  assert.deepEqual(normalizeRecord('x'), { file: '', path: '', url: '' })

  assert.deepEqual(splitEmotionTags('<|HAPPY|>今天<|Sigh|>好累<|Speech|>'), {
    text: '今天好累',
    tags: ['HAPPY', 'Sigh', 'Speech'],
  })
  assert.deepEqual(splitEmotionTags('  <|Cry|>  '), { text: '', tags: ['Cry'] })
  assert.deepEqual(splitEmotionTags('普通文本'), { text: '普通文本', tags: [] })
  assert.deepEqual(splitEmotionTags(null), { text: '', tags: [] })
  assert.deepEqual(splitEmotionTags('<|HAPPY'), { text: '<|HAPPY', tags: [] })
})
