import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const MAX_BYTES = 80 * 1024 * 1024
export function asrPython() {
  if (process.env.QQ_BRIDGE_ASR_PYTHON) return process.env.QQ_BRIDGE_ASR_PYTHON
  const existing = join(process.env.WHALEGIRL_ROOT || process.cwd(), '.desktop-runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  return existsSync(existing) ? existing : process.env.QQ_BRIDGE_PYTHON || 'python'
}

export function createVideoAnalyzer({ describeFrames, logger = console, run = exec, root = join(homedir(), '.dsh', 'qq-bridge-video-tmp'), python = asrPython, asrScript = process.env.QQ_BRIDGE_ASR_SCRIPT || '' }) {
  return async function analyze({ path = '', url = '', signal } = {}) {
    mkdirSync(root, { recursive: true })
    const dir = mkdtempSync(join(root, 'v-'))
    const warnings = []
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(6 * 60 * 1000)])
    const call = (command, args, timeout = 60000) => run(command, args, { timeout, signal: combined, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    try {
      let video = path
      if (!video && url) {
        if (!/^https?:\/\//i.test(url)) throw new Error('只支持 http(s) 视频地址')
        const host = new URL(url).hostname.toLowerCase()
        const platform = ['bilibili.com', 'b23.tv', 'xiaohongshu.com', 'xhslink.com'].some(h => host === h || host.endsWith('.' + h))
        if (platform) {
          await call('yt-dlp', ['--no-playlist', '--max-filesize', '80M', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '-o', join(dir, 'video.%(ext)s'), '--', url], 240000)
          const name = readdirSync(dir).find(n => /\.(mp4|mkv|webm)$/i.test(n))
          if (!name) throw new Error('下载未产出视频文件（可能超过大小上限）')
          video = join(dir, name)
        } else {
          const res = await fetch(url, { signal: combined })
          if (!res.ok) throw new Error(`视频下载 HTTP ${res.status}`)
          if (Number(res.headers.get('content-length')) > MAX_BYTES) { await res.body?.cancel(); throw new Error('视频超过 80MB') }
          const buffers = []
          let bytes = 0
          for await (const chunk of res.body) {
            bytes += chunk.length
            if (bytes > MAX_BYTES) throw new Error('视频超过 80MB')
            buffers.push(chunk)
          }
          video = join(dir, 'video.mp4')
          writeFileSync(video, Buffer.concat(buffers))
        }
      }
      if (!video || !existsSync(video)) throw new Error('找不到视频文件')
      if (statSync(video).size > MAX_BYTES) throw new Error('视频超过 80MB')
      const probe = await call('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], 20000)
      const duration = Number(String(probe.stdout).trim())
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取有效视频时长')
      const count = Math.max(1, Math.min(24, Math.ceil(duration)))
      await call('ffmpeg', ['-y', '-i', video, '-vf', `fps=${count / duration},scale=512:-2`, '-frames:v', String(count), join(dir, 'f-%03d.jpg')])
      const frames = readdirSync(dir).filter(n => /^f-\d+\.jpg$/.test(n)).sort().slice(0, 24).map((n, i) => ({ path: join(dir, n), mediaType: 'image/jpeg', seconds: (i + 0.5) * duration / count }))
      const descriptions = []
      for (let i = 0; i < frames.length; i += 4) {
        combined.throwIfAborted()
        const r = await describeFrames(frames.slice(i, i + 4), combined)
        if (r?.ok && r.text) descriptions.push(r.text)
        else warnings.push(`第 ${Math.floor(i / 4) + 1} 批画面识别失败：${r?.reason ?? '无结果'}`)
      }
      let transcript = ''
      try {
        const wav = join(dir, 'audio.wav')
        await call('ffmpeg', ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', wav])
        const txt = join(dir, 'asr.txt')
        await call(python(), [asrScript, '--wav', wav, '--out', txt], 180000)
        if (existsSync(txt)) transcript = readFileSync(txt, 'utf8').replace(/^\s*\[[\d: .-]+\]\s*/gm, '').trim().slice(0, 1500)
      } catch (error) { warnings.push(`语音转写不可用：${String(error.message).slice(0, 220)}`) }
      const text = [descriptions.length ? '画面：' + descriptions.join(' ') : '', transcript ? '台词：' + transcript : ''].filter(Boolean).join('\n')
      if (!text) return { ok: false, error: '没有识别到画面或台词', warnings }
      return { ok: true, text, warnings, frames: frames.length, visionCalls: Math.ceil(frames.length / 4) }
    } catch (error) {
      logger.warn?.(`视频处理失败：${error.message}`)
      return { ok: false, error: error.message, warnings }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}
