import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { CLIP_GROUPS, createVoiceLibrary, recordSegment } from '../voice.js'

const mp3 = Buffer.from('49443304000000000000fffb900064000000', 'hex')

function clip(name, style, group = 'laugh', extra = {}) {
  return {
    name,
    label: `${name}-${style}`,
    group,
    style,
    file: `${style}/${name}.mp3`,
    ms: 900,
    bytes: mp3.length,
    ...extra,
  }
}

function fakeManifest() {
  return {
    version: 1,
    generatedAt: '2026-10-25T00:00:00+00:00',
    styles: {
      cute: { voice: 'zh-CN-XiaoyiNeural', rate: '-6%', pitch: '+18Hz' },
      gentle: { voice: 'zh-CN-XiaoxiaoNeural', rate: '-8%', pitch: '+6Hz' },
    },
    clips: [
      clip('laugh_1', 'cute'),
      clip('laugh_2', 'cute'),
      clip('laugh_1', 'gentle'),
      clip('cry_1', 'cute', 'cry'),
    ],
    groups: { laugh: ['laugh_1', 'laugh_2'], cry: ['cry_1'] },
  }
}

/** 建一个临时素材目录；默认写好 manifest 与全部 mp3。 */
function fixture(t, { manifest, manifestText, writeManifest = true, writeFiles = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'whale-voice-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const data = manifest ?? fakeManifest()
  if (writeManifest) {
    const text = manifestText ?? `${JSON.stringify(data, null, 2)}\n`
    writeFileSync(join(dir, 'manifest.json'), text)
  }
  if (writeFiles) {
    const clips = Array.isArray(data?.clips) ? data.clips : []
    for (const entry of clips) {
      if (!entry?.file || entry.file.includes('..') || /^([\\/]|[A-Za-z]:)/.test(entry.file)) continue
      const full = join(dir, entry.file)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, mp3)
    }
  }
  const silent = { warn() {} }
  const library = createVoiceLibrary({ dir, logger: silent })
  return { dir, library, manifest: data }
}

test('读清单后能列出、读取并回报状态', (t) => {
  const { dir, library } = fixture(t)
  const status = library.status()
  assert.equal(status.available, true)
  assert.equal(status.dir, resolve(dir))
  assert.deepEqual(status.styles, ['cute', 'gentle'])
  assert.equal(status.clips, 4)
  assert.equal(status.error, undefined)

  assert.deepEqual(readFileSync(join(dir, 'cute/laugh_1.mp3')), mp3)
  assert.deepEqual(library.read('laugh_1', 'cute'), mp3)
  assert.deepEqual(library.read('laugh_1', 'gentle'), mp3)

  const all = library.list()
  assert.equal(all.length, 4)
  assert.deepEqual(Object.keys(all[0]).sort(), ['bytes', 'group', 'label', 'ms', 'name', 'style'])
})

test('manifest() 返回的是一份拷贝，改它不影响库', (t) => {
  const { library } = fixture(t)
  const first = library.manifest()
  first.clips.length = 0
  first.styles.cute.rate = '+99%'
  assert.equal(library.manifest().clips.length, 4)
  assert.equal(library.manifest().styles.cute.rate, '-6%')
})

test('缺少 manifest：available=false，所有读操作返回空值且不抛', (t) => {
  const { library } = fixture(t, { writeManifest: false })
  assert.equal(library.status().available, false)
  assert.equal(library.status().error, 'manifest-missing')
  assert.deepEqual(library.list('cute'), [])
  assert.equal(library.read('laugh_1', 'cute'), null)
  assert.equal(library.pick('laugh', 'cute'), null)
  assert.equal(library.manifest(), null)
})

test('manifest 损坏：报告原因，绝不抛异常', (t) => {
  for (const [text, error] of [
    ['{broken', 'manifest-invalid'],
    ['[]', 'manifest-invalid'],
    [JSON.stringify({ version: 2, styles: {}, clips: [], groups: {} }), 'manifest-version:2'],
    [JSON.stringify({ version: 1, styles: {}, clips: 'nope' }), 'manifest-clips'],
    [JSON.stringify({ version: 1, styles: {}, clips: [] }), 'manifest-empty'],
  ]) {
    const { library } = fixture(t, { manifest: { clips: [] }, manifestText: text })
    const status = library.status()
    assert.equal(status.available, false)
    assert.equal(status.error, error)
    assert.deepEqual(library.list(), [])
    assert.equal(library.read('laugh_1', 'cute'), null)
  }
})

test('未知 style 与未知名字都返回空', (t) => {
  const { library } = fixture(t)
  assert.deepEqual(library.list('shouting'), [])
  assert.equal(library.read('laugh_1', 'shouting'), null)
  assert.equal(library.read('nope', 'cute'), null)
  assert.equal(library.pick('nope', 'cute'), null)
})

test('路径穿越与绝对路径一律拒绝', (t) => {
  const escaped = fakeManifest()
  escaped.clips.push(
    clip('evil_1', 'cute', 'laugh', { file: '../evil.mp3' }),
    clip('evil_2', 'cute', 'laugh', { file: 'cute/../../evil.mp3' }),
    clip('evil_3', 'cute', 'laugh', { file: 'C:/Windows/System32/evil.mp3' }),
    clip('evil_4', 'cute', 'laugh', { file: '/etc/passwd' }),
    clip('evil_5', 'cute', 'laugh', { file: 'cute//laugh_1.mp3' }),
  )
  const { dir, library } = fixture(t, { manifest: escaped })
  mkdirSync(join(dir, 'cute'), { recursive: true })
  for (const name of ['evil_1', 'evil_2', 'evil_3', 'evil_4', 'evil_5']) {
    assert.equal(library.read(name, 'cute'), null, name)
  }
  assert.deepEqual(library.read('laugh_1', 'cute'), mp3)

  // 组里混进坏路径时，pick 至少不会读到目录外面的文件
  const picked = library.pick('laugh', 'cute', () => 0)
  assert.equal(picked.name, 'laugh_1')
})

test('pick 按注入的随机源在组内选择，且只选该声线', (t) => {
  const { library } = fixture(t)
  assert.equal(library.pick('laugh', 'cute', () => 0).name, 'laugh_1')
  assert.equal(library.pick('laugh', 'cute', () => 0.99).name, 'laugh_2')
  assert.equal(library.pick('laugh', 'gentle', () => 0.99).name, 'laugh_1')
  assert.equal(library.pick('cry', 'cute', () => 0).name, 'cry_1')
  // 脏 random 也不许越界
  assert.equal(library.pick('laugh', 'cute', () => Number.NaN).name, 'laugh_1')
  assert.equal(library.pick('laugh', 'cute', () => 5).name, 'laugh_2')
  const random = library.pick('laugh', 'cute')
  assert.deepEqual(Object.keys(random).sort(), ['bytes', 'name'])
  assert.deepEqual(random.bytes, mp3)
})

test('pick 认得只存在于某个声线的 clip，也认得直接给的名字', (t) => {
  const { library } = fixture(t)
  assert.equal(library.pick('laugh_2', 'cute').name, 'laugh_2')
  assert.equal(library.pick('laugh_2', 'gentle'), null)
  assert.equal(library.pick('', 'cute'), null)
  assert.equal(library.pick(null, 'cute'), null)
})

test('list 按 style 过滤', (t) => {
  const { library } = fixture(t)
  assert.deepEqual(library.list('cute').map((e) => e.name), ['laugh_1', 'laugh_2', 'cry_1'])
  assert.deepEqual(library.list('gentle').map((e) => e.name), ['laugh_1'])
  assert.deepEqual(library.list('gentle').map((e) => e.style), ['gentle'])
  assert.equal(library.list().length, 4)
})

test('recordSegment 生成 OneBot record 段', () => {
  const segment = recordSegment(mp3)
  assert.deepEqual(Object.keys(segment).sort(), ['data', 'type'])
  assert.equal(segment.type, 'record')
  assert.equal(segment.data.file, `base64://${mp3.toString('base64')}`)
  assert.deepEqual(Buffer.from(segment.data.file.slice('base64://'.length), 'base64'), mp3)
  assert.equal(recordSegment(Buffer.alloc(0)).data.file, 'base64://')
})

test('CLIP_GROUPS 覆盖 manifest 里的所有组', (t) => {
  const { library } = fixture(t)
  const groups = Object.keys(library.manifest().groups)
  for (const group of groups) assert.ok(CLIP_GROUPS.includes(group), group)
})
