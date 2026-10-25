// Real local ffmpeg + SenseVoice pipeline; vision is stubbed to avoid cloud calls.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createVideoAnalyzer } from '../video.js'

const run = promisify(execFile)
const dir = mkdtempSync(join(tmpdir(), 'whale-video-smoke-'))
try {
  const path = join(dir, 'sample.mp4')
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=4', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '2', '-c:v', 'mpeg4', '-c:a', 'aac', path], { windowsHide: true, timeout: 30000 })
  let batches = 0
  const root = join(dir, 'frames')
  const analyze = createVideoAnalyzer({ root, describeFrames: async frames => {
    batches++
    assert.equal(frames.length, 2)
    return { ok: true, text: '模拟视觉返回：彩色测试画面' }
  } })
  const result = await analyze({ path })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.frames, 2)
  assert.equal(batches, 1)
  assert.deepEqual(result.warnings, [], JSON.stringify(result.warnings))
  assert.deepEqual(readdirSync(root), [])
  console.log('VIDEO_SMOKE_OK: real ffmpeg + local SenseVoice; stubbed vision; temporary files cleaned')
} finally { rmSync(dir, { recursive: true, force: true }) }
