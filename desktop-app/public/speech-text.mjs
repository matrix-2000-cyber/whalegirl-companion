// Presentation only: never rewrite stored conversations or memory.
function sentences(text){
  const result=[];let current=''
  const chars=Array.from(String(text??'').replace(/\r\n?/g,'\n'))
  for(let i=0;i<chars.length;i++){
    const ch=chars[i];current+=ch
    const period=ch==='.'&&!/\d/.test(chars[i-1]||'')&&(!chars[i+1]||/\s/.test(chars[i+1]))
    if(ch==='\n'||/[。！？!?；;~～]/u.test(ch)||period){
      while(/[。！？!?；;~～”’」』"]/.test(chars[i+1]||'\u0000'))current+=chars[++i]
      if(current.trim())result.push(current.trim());current=''
    }
  }
  if(current.trim())result.push(current.trim())
  return result
}
export function uniqueSentences(text){
  const seen=new Set()
  return sentences(text).filter(sentence=>{
    const key=sentence.normalize('NFKC').replace(/\s/g,'').replace(/[。！？!?；;~～.…”’」』"]+$/gu,'')
    if(!key||seen.has(key))return false
    seen.add(key);return true
  })
}
function shortLines(sentence,max=20){
  const lines=[];let chars=Array.from(sentence)
  while(chars.length>max){
    let end=max
    for(let i=max-1;i>=Math.floor(max*.45);i--){if(/[，,、：:\s]/u.test(chars[i])){end=i+1;break}}
    // Keep an English word or number intact when it crosses the line boundary.
    if(/[A-Za-z0-9]/.test(chars[end-1])&&/[A-Za-z0-9.]/.test(chars[end])){
      while(end<chars.length&&/[A-Za-z0-9._/-]/.test(chars[end]))end++
    }
    lines.push(chars.slice(0,end).join('').trim());chars=chars.slice(end)
  }
  if(chars.length)lines.push(chars.join('').trim())
  return lines.filter(Boolean)
}
export function formatReply(text){return uniqueSentences(text).flatMap(sentence=>shortLines(sentence)).join('\n')}
export function speechText(text){
  return uniqueSentences(text).flatMap(sentence=>{
    const lines=shortLines(sentence)
    return lines.map((line,index)=>{
      line=line.replace(/[~～]+([”’」』"]*)$/u,'。$1')
      return /[。！？!?；;，,：:.…][”’」』"]*$/u.test(line)?line:line+(index===lines.length-1?'。':'，')
    })
  }).join('\n')
}
export function createPlaybackGate(limit=100){
  const played=new Set()
  return {claim(id){if(played.has(id))return false;played.add(id);if(played.size>limit)played.delete(played.values().next().value);return true}}
}
