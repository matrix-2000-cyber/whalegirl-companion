import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {asrPython} from '../bridge-src/video.js'
import {speechText} from './public/speech-text.mjs'
const stopped=()=>Error('语音合成连接中断，请重新试听')
export function createWarmSpeechService({python=asrPython,spawnChild=spawn,timeoutMs=45000}={}){
  let child=null,readyPromise=null,isReady=false,closed=false,tail=Promise.resolve(),waiting=0,lastFirstAudioMs=null,rejectStarting=null,readyTimer=null
  const requests=new Map()
  function close(){closed=true;clearTimeout(readyTimer);rejectStarting?.(stopped());rejectStarting=null;child?.kill();child=null;isReady=false;for(const req of requests.values()){req.error=stopped();req.wake?.()}requests.clear()}
  function ready(){
    if(closed)return Promise.reject(stopped())
    if(readyPromise)return readyPromise
    readyPromise=new Promise((resolveReady,rejectReady)=>{
      rejectStarting=rejectReady
      let proc,buffer='',settled=false
      const fail=()=>{
        if(child!==proc)return
        clearTimeout(timer);rejectStarting=null;isReady=false
        if(!settled){settled=true;rejectReady(stopped())}
        for(const req of requests.values()){req.error=stopped();req.wake?.()}
        requests.clear();child=null;readyPromise=null;proc.kill()
      }
      const timer=setTimeout(fail,15000)
      readyTimer=timer
      try{proc=spawnChild(python(),['-u',join(dirname(fileURLToPath(import.meta.url)),'tts-worker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}})}catch{clearTimeout(timer);rejectReady(stopped());return}
      child=proc;proc.stderr?.resume();proc.on('error',fail);proc.on('exit',fail);proc.stdin.on('error',fail)
      proc.stdout.setEncoding('utf8');proc.stdout.on('data',chunk=>{
        buffer+=chunk;if(buffer.length>1000000){fail();return}
        let end;while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value
          try{value=JSON.parse(line)}catch{continue}
          if(value.ready){clearTimeout(timer);rejectStarting=null;settled=true;isReady=true;resolveReady();continue}
          const req=requests.get(value.id);if(!req)continue
          if(value.audio){const audio=Buffer.from(value.audio,'base64');req.bytes+=audio.length;if(req.bytes>4000000)req.error=Error('声音内容过长');else{req.chunks.push(audio);if(req.first){req.first=false;lastFirstAudioMs=Date.now()-req.started}}}
          if(value.error)req.error=stopped()
          if(value.done)req.done=true
          req.wake?.()
        }
      })
    })
    // A synchronous spawn exception must not poison all subsequent attempts.
    readyPromise.catch(()=>{if(!child&&!closed)readyPromise=null})
    return readyPromise
  }
  function send(value){if(child?.stdin.writable)child.stdin.write(JSON.stringify(value)+'\n')}
  async function* stream(text,style='cute',signal){
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw Error('朗读内容需在2000字以内')
    if(!['cute','gentle'].includes(style))throw Error('请选择页面中的声音')
    if(waiting>=4)throw Error('声音队列已满，请稍等')
    waiting++;const previous=tail;let release;const slot=new Promise(r=>release=r);tail=previous.then(()=>slot)
    let req,id,timer,abort
    try{
      await previous;signal?.throwIfAborted();await ready();signal?.throwIfAborted()
      id=randomUUID();req={chunks:[],bytes:0,first:true,started:Date.now(),done:false,error:null,wake:null};requests.set(id,req)
      abort=()=>{req.error=signal.reason||new DOMException('Aborted','AbortError');req.wake?.()}
      signal?.addEventListener('abort',abort,{once:true})
      timer=setTimeout(()=>{req.error=Error('语音合成等待超时，请重试');req.wake?.()},timeoutMs)
      send({id,text:speechText(text),style})
      while(true){
        if(req.error)throw req.error
        if(req.chunks.length){yield req.chunks.shift();continue}
        if(req.done)break
        await new Promise(r=>req.wake=r);req.wake=null
      }
      if(req.bytes<256)throw stopped()
    }finally{
      clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort)
      if(id){requests.delete(id);if(!req.done)send({id,cancel:true})}
      waiting--;release()
    }
  }
  return {ready,stream,close,status:()=>({ready:isReady,persistent:true,queued:waiting,lastFirstAudioMs})}
}
