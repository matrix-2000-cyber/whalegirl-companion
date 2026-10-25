import {setTimeout as pause} from 'node:timers/promises'
export async function* liveChat({gateway,id,text,image,useVision,faceCue,initiative,signal,pollMs=120}){
  let job=await gateway('/v1/chat',{id,text,realtime:true,...(image?{image}:{}),...(useVision?{useVision:true}:{}),...(faceCue?{faceCue}:{}),...(initiative?{initiative}:{})}),last=''
  yield {type:'accepted',id}
  const deadline=Date.now()+190000
  while(true){
    signal?.throwIfAborted()
    const next=job.status==='done'?job.text:job.partial
    if(next&&next!==last){last=next;yield {type:'text',text:next}}
    if(job.status==='done'){yield {type:'done',id,text:job.text,timings:job.timings,...(job.warning?{warning:job.warning,vision:job.vision}:{})};return}
    if(job.status!=='pending')throw Error(job.error||'这轮没有完成，请再说一句')
    if(Date.now()>deadline)throw Error('这轮等得太久，请先查看对话记录')
    await pause(pollMs,undefined,{signal});job=await gateway('/v1/jobs/'+id)
  }
}
