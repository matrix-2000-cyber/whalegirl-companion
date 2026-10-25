import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { asrPython } from '../bridge-src/video.js'
const exec = promisify(execFile)

export function createTranscriber({ root, run = exec, python = asrPython, decode,script = process.env.QQ_BRIDGE_ASR_SCRIPT || '' }) {
  let busy = false
  return async (base64,{trimStartMs=0}={}) => {
    if (busy) throw Error('正在听上一段，请稍等')
    if(!Number.isFinite(trimStartMs)||trimStartMs<0||trimStartMs>28000)throw Error('录音起点无效，请重新说一遍')
    if (typeof base64 !== 'string' || base64.length > 4_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw Error('录音太长或格式不支持，请每次说30秒以内')
    const data = Buffer.from(base64, 'base64')
    if (data.length < 44 || data.length > 3_000_000) throw Error('没有收到有效录音')
    const tag=data.subarray(0,4).toString('ascii')
    if(!(tag==='RIFF'||tag==='OggS'||data.readUInt32BE(0)===0x1a45dfa3||data.subarray(4,8).toString('ascii')==='ftyp')) throw Error('录音格式不支持，请用 Edge 重新录制')
    if (!decode&&(!existsSync(script) || !existsSync(python()))) throw Error('本地语音识别尚未准备好，请先打字聊天')
    busy = true
    const cacheRoot = resolve(root)
    let dir
    try {
      mkdirSync(cacheRoot, { recursive: true })
      dir = mkdtempSync(join(cacheRoot, 'clip-'))
      const source = join(dir, 'input.media'), wav = join(dir, 'speech.wav'), out = join(dir, 'words.txt')
      writeFileSync(source, data)
      await run('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',source,...(trimStartMs?['-ss',(trimStartMs/1000).toFixed(3)]:[]),'-t','30','-vn','-ac','1','-ar','16000',wav], { windowsHide: true, timeout: 25000, maxBuffer: 128 * 1024 })
      if(decode)return String(await decode(wav)).trim().slice(0,2000)
      await run(python(), [script,'--wav',wav,'--out',out,'--lang','zh'], { windowsHide: true, timeout: 90000, maxBuffer: 256 * 1024 })
      if (!existsSync(out)) throw Error('未识别到清楚的语音')
      return readFileSync(out,'utf8').replace(/^\s*\[[\d: .-]+\]\s*/gm,'').trim().slice(0,2000)
    } catch(e) {
      if (e.message === '未识别到清楚的语音') throw e
      throw Error('这段没听清，请再说一次；也可以先打字')
    } finally {
      busy = false
      if(dir){
        const target = resolve(dir)
        if (!target.startsWith(cacheRoot + sep)) throw Error('Unexpected audio cache path')
        rmSync(target, { recursive: true, force: true })
      }
    }
  }
}
