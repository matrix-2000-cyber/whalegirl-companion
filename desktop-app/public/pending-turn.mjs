const key='whale-pending'
export function forgetPending(storage,id){
  if(storage.getItem(key)===id)storage.removeItem(key)
}
export async function recoverPending({storage,getJob,signal}){
  const id=storage.getItem(key)
  if(!id)return null
  signal?.throwIfAborted()
  try{
    const job=await getJob(id)
    if(job.status!=='pending')forgetPending(storage,id)
    return job
  }catch(error){
    if(error.status!==404)throw error
    // An absent receipt must not permanently block unrelated new speech.
    // Do not replay its text: upstream completion may still be uncertain.
    forgetPending(storage,id)
    return {id,status:'missing'}
  }
}
export async function waitForPending({storage,getJob,signal,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
  const deadline=now()+190000
  while(true){
    signal?.throwIfAborted()
    const job=await recoverPending({storage,getJob,signal})
    if(job?.status!=='pending')return job
    if(now()>deadline)throw Error('上一轮还未结束，请查看记录')
    await pause(120)
  }
}
