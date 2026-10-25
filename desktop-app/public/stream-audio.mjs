export function canStreamAudio(){return typeof MediaSource!=='undefined'&&MediaSource.isTypeSupported('audio/mpeg')}
function once(target,type,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{target.removeEventListener(type,ok);target.removeEventListener('error',bad);signal.removeEventListener('abort',abort)}
    const ok=()=>{cleanup();resolve()},bad=()=>{cleanup();reject(Error('流式声音解码失败'))},abort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'))}
    if(signal.aborted){abort();return}
    target.addEventListener(type,ok,{once:true});target.addEventListener('error',bad,{once:true});signal.addEventListener('abort',abort,{once:true})
  })
}
export async function streamAudio({player,text,style,csrf,signal,onUrl,onPlayable,responsePromise}){
  const source=new MediaSource(),url=URL.createObjectURL(source)
  onUrl(url);player.src=url;player.hidden=false;player.load()
  await once(source,'sourceopen',signal)
  const buffer=source.addSourceBuffer('audio/mpeg');buffer.mode='sequence'
  const response=await (responsePromise||fetch('/api/speech-stream',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-whale-csrf':csrf},body:JSON.stringify({text,style}),signal}))
  if(!response.ok){const value=await response.json();throw Error(value.error||'暂时无法生成声音')}
  const reader=response.body.getReader();let started=false,total=0,complete=false
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break
      signal.throwIfAborted();total+=value.byteLength;if(total>4_000_000)throw Error('声音内容过长')
      if(!value.byteLength)continue
      buffer.appendBuffer(value);await once(buffer,'updateend',signal)
      if(!started){started=true;onPlayable()}
    }
    if(!started)throw Error('没有收到可播放的声音')
    if(source.readyState==='open')source.endOfStream()
    complete=true
  }finally{
    if(!complete){await reader.cancel().catch(()=>{});try{if(source.readyState==='open')source.endOfStream('network')}catch{}}
    reader.releaseLock()
  }
}
