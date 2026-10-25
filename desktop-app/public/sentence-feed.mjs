export function createSentenceFeed(){
  let committed='',last='';const seen=new Set()
  return {update(text,done=false){
    text=String(text||'')
    if(!text.startsWith(committed))throw Error('回答发生修订，已停止旧声音，请查看文字')
    const result=[];let cursor=committed.length,start=cursor
    for(;cursor<text.length;cursor++)if(/[。！？!?；;\n~～]/u.test(text[cursor])){
      while(/[。！？!?；;”’」』"]/.test(text[cursor+1]||'\0'))cursor++
      result.push(text.slice(start,cursor+1));start=cursor+1
    }
    if(done&&start<text.length){result.push(text.slice(start));start=text.length}
    committed=text.slice(0,start);last=text
    return result.map(s=>s.trim()).filter(s=>{
      const key=s.normalize('NFKC').replace(/[\s。！？!?；;~～]/g,'')
      if(!key||seen.has(key))return false;seen.add(key);return true
    })
  },snapshot:()=>last}
}
