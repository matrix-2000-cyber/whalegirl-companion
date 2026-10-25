import { execFile,spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asrPython } from '../bridge-src/video.js'
import { speechText } from './public/speech-text.mjs'
const exec=promisify(execFile)
const script=join(dirname(fileURLToPath(import.meta.url)),'tts.py')
export function createSpeaker({root,run=exec,python=asrPython}){
  let busy=false
  return async (text,style='cute')=>{
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw Error('朗读内容需在2000字以内')
    if(!['cute','gentle'].includes(style))throw Error('请选择页面中的声音')
    if(busy)throw Error('上一段声音还在准备，请稍后再试')
    busy=true
    let dir
    try{
      mkdirSync(root,{recursive:true});dir=mkdtempSync(join(resolve(root),'voice-'))
      const input=join(dir,'text.txt'),output=join(dir,'speech.mp3')
      writeFileSync(input,speechText(text),'utf8')
      await run(python(),[script,input,output,style],{windowsHide:true,timeout:45000,maxBuffer:64*1024})
      const audio=readFileSync(output)
      if(audio.length<256||audio.length>4_000_000)throw Error('Invalid generated audio')
      return {audio:audio.toString('base64'),mime:'audio/mpeg',voice:style==='cute'?'晓伊 · 轻柔可爱':'晓晓 · 温柔自然'}
    }catch{throw Error('声音暂时没生成，请点试听再试一次，并检查网络连接')}
    finally{if(dir)rmSync(dir,{recursive:true,force:true});busy=false}
  }
}

export function createSpeechStreamer({root,python=asrPython,spawnChild=spawn}){
  let tail=Promise.resolve(),waiting=0
  return async function* (text,style='cute',signal){
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw Error('朗读内容需在2000字以内')
    if(!['cute','gentle'].includes(style))throw Error('请选择页面中的声音')
    if(waiting>=4)throw Error('声音队列已满，请稍等')
    waiting++;const previous=tail;let release;tail=new Promise(resolve=>release=resolve)
    await previous
    let dir,child
    try{
      signal?.throwIfAborted()
      mkdirSync(root,{recursive:true});dir=mkdtempSync(join(resolve(root),'stream-'))
      const input=join(dir,'text.txt');writeFileSync(input,speechText(text),'utf8')
      child=spawnChild(python(),[script,input,'-',style],{windowsHide:true,stdio:['ignore','pipe','pipe'],signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)})
      child.stderr?.resume()
      let spawnError
      const exited=new Promise(resolve=>{child.once('error',e=>{spawnError=e;child.stdout?.destroy(e);resolve(-1)});child.once('close',code=>resolve(code))})
      let bytes=0
      for await(const chunk of child.stdout){bytes+=chunk.length;if(bytes>4_000_000)throw Error('Audio too long');yield chunk}
      if(await exited!==0||spawnError||bytes<256)throw Error('Speech stream failed')
    }catch{throw Error('声音生成中断，请重新试听或重发一句话')}
    finally{try{if(child&&child.exitCode===null)child.kill();if(dir)rmSync(dir,{recursive:true,force:true})}finally{waiting--;release()}}
  }
}
