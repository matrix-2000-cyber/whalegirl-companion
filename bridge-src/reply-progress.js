// Ephemeral assistant output only. This never changes the conversation or memory.
export function createReplyProgress(){
  const records=new Map()
  return {begin(id){
    if(!/^[a-f0-9-]{36}$/.test(id||''))return null
    const receipt={id,text:'',revision:0,done:false,created:Date.now()};records.set(id,receipt)
    for(const [key,value] of records)if(value.done&&(Date.now()-value.created>300000||records.size>50))records.delete(key)
    return receipt
  },read(id){const r=records.get(id);return r?{id:r.id,text:r.text,revision:r.revision,done:r.done,firstTextMs:r.firstTextMs}:null}}
}
