// A small prefetch window overlaps synthesis with playback, preserving order.
export function createReplyPlayer({signal,prepare,play,canPlay=()=>true}={}){
  const items=[];let running=false,finished=false,failed=null,settled=false,resolveDone,rejectDone
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject});done.catch(()=>{})
  function settle(){if(!running&&(finished||signal?.aborted||failed)&&!settled){settled=true;failed?rejectDone(failed):resolveDone()}}
  function prime(){for(const item of items.slice(0,2))if(!item.prepared){item.prepared=true;item.response=prepare(item.text);item.response?.catch(()=>{})}}
  async function pump(){
    if(running||failed)return;running=true
    try{while(items.length&&!signal?.aborted&&canPlay()){prime();const item=items.shift();prime();await play(item.text,item.response)}}
    catch(e){if(!signal?.aborted)failed=e;items.length=0}
    finally{running=false;settle()}
  }
  signal?.addEventListener('abort',()=>{items.length=0;settle()},{once:true})
  return {push(text){if(finished||signal?.aborted||failed||!canPlay())return;items.push({text});prime();void pump()},finish(){finished=true;settle();return done},cancel(){items.length=0;finished=true;settle()}}
}
