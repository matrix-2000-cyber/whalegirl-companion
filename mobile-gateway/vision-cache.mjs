// Per paired device, in memory only. Never retain raw frames or cross devices.
export function createVisionCache({now=Date.now,maxAgeMs=10000,minIntervalMs=3500}={}){
  const frames=new Map(),versions=new Map(),pending=new Set(),last=new Map()
  return {clear(id){versions.set(id,(versions.get(id)||0)+1);frames.delete(id);last.delete(id)},
    read(id){const value=frames.get(id);return value&&now()-value.observedAt<=maxAgeMs?{text:value.text,ageMs:Math.max(0,now()-value.observedAt),observedAt:value.observedAt}:null},
    async observe(id,image,analyze){
      if(pending.has(id)||now()-(last.get(id)??-Infinity)<minIntervalMs)return {busy:true,observation:this.read(id)}
      const version=versions.get(id)||0,observedAt=now();pending.add(id);last.set(id,observedAt)
      try{
        const value=await analyze(image),text=String(value.text||'').slice(0,1800)
        if(!text)throw Error('本次画面没看清')
        if((versions.get(id)||0)!==version)return {discarded:true,observation:null}
        frames.set(id,{text,observedAt});return {observation:this.read(id)}
      }finally{pending.delete(id)}
    }}
}
