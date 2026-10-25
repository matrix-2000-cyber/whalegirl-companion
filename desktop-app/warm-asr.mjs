import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {join,resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {asrPython} from '../bridge-src/video.js'
export function createWarmRecognizer({root,python=asrPython,spawnChild=spawn,modelDir=join(process.env.MEET_MODELS||join(process.env.WHALEGIRL_ROOT||process.cwd(),'.desktop-runtime/models'),'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')}={}){
  let child=null,readyPromise=null,isReady=false,loadMs=null,lastDecodeMs=null,closed=false
  const requests=new Map()
  function close(){closed=true;child?.kill();child=null;isReady=false;for(const item of requests.values())item.reject(Error('语音识别服务已停止'));requests.clear()}
  function ready(){
    if(closed)return Promise.reject(Error('语音识别服务已停止'))
    if(readyPromise)return readyPromise
    readyPromise=new Promise((resolveReady,rejectReady)=>{
      let buffer='',settled=false,proc
      const timer=setTimeout(()=>fail(),60000)
      const fail=()=>{clearTimeout(timer);if(child!==proc)return;isReady=false;if(!settled){settled=true;rejectReady(Error('语音识别预热失败'))}for(const item of requests.values())item.reject(Error('语音识别服务中断'));requests.clear();child?.kill();child=null;readyPromise=null}
      proc=spawnChild(python(),['-u',join(dirname(fileURLToPath(import.meta.url)),'asr-worker.py'),modelDir,resolve(root)],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});child=proc
      child.stderr?.resume();child.on('error',fail);child.on('exit',fail)
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        buffer+=chunk;if(buffer.length>65536){fail();return}
        let end;while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1)
          let value;try{value=JSON.parse(line)}catch{continue}
          if(value.ready){isReady=true;loadMs=value.loadMs;clearTimeout(timer);settled=true;resolveReady();continue}
          const item=requests.get(value.id)
          if(item){requests.delete(value.id);if(value.error)item.reject(Error(value.error));else{lastDecodeMs=value.decodeMs;item.resolve(value.text)}}
          else if(value.error&&!settled)fail()
        }
      })
    })
    return readyPromise
  }
  async function decode(wav){
    await ready();const id=randomUUID()
    return new Promise((resolveRequest,rejectRequest)=>{
      const timer=setTimeout(()=>{requests.delete(id);rejectRequest(Error('语音识别超时'));close()},30000)
      requests.set(id,{resolve:value=>{clearTimeout(timer);resolveRequest(value)},reject:error=>{clearTimeout(timer);rejectRequest(error)}})
      child.stdin.write(JSON.stringify({id,wav:resolve(wav)})+'\n',error=>{if(error){const item=requests.get(id);requests.delete(id);item?.reject(Error('语音识别连接中断'))}})
    })
  }
  return {ready,decode,close,status:()=>({ready:isReady,loadMs,lastDecodeMs,persistent:true})}
}
