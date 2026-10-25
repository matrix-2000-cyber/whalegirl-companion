// Presentation only: decide whether her own reply starts with a laugh/sob/etc. and
// strip the onomatopoeia that the clip already carries. Pure and dependency free so
// both the page and node:test can import it directly.
const LIMIT=200
const ORDER=['cry','laugh','angry','sigh','happy','surprise']
const CLIPS={cry:'cry_1',laugh:'laugh_1',angry:'angry_1',sigh:'sigh_1',happy:'happy_1',surprise:'surprise_1'}
const CUES={
  cry:/呜{2,}|555|T[_ ]?T|😭|😢|哭(了|着|出来)|想哭/,
  laugh:/哈{3,}|哈哈|嘿{2,}|嘻{2,}|笑死|笑出声|噗嗤/,
  angry:/哼[！!，,。…\s]|气死|生气|讨厌死/,
  sigh:/唉[，。…！?\s]|哎[，。…！?\s]|叹气|唉声叹气/,
  happy:/好耶|耶[！!～~]|开心|太棒了|好开心/,
  surprise:/诶？|欸？|啊？|诶嘿|哇[！!～~]/,
}
// "别哭/不哭" comforts someone else; it is not her own tears.
const COMFORT=/(?:别|不要|不许|不准)哭(?:了|啦|啊)?|不哭(?:了|啦|啊)?/g
// Sounds the clip already conveys: repeated laughs/sobs, 555, T_T and emoji.
const FILLER=/哈{2,}|嘿{2,}|嘻{2,}|呵{2,}|呜{2,}|5{3,}|T[_ ]?T|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu
// A standalone "唉/哎" is the sigh itself, which the clip already covers.
const SIGH_FILLER=/(^|[，,。！？!?…；;：:\s])[唉哎]+(?=[，,。…！？!?～~\s]|$)/gu

export function isOnlyVocalSound(text,clip){
  return !!clip&&typeof text==='string'&&/^[\s哈嘿嘻呵呜唉哎5T_哭泣😭😢。！，、…~～!?]+$/u.test(text)
}

function tidy(text){
  return text
    .replace(/^[\s，,、。！!？?…~～：:；;]+/u,'')
    .replace(/[ \t]*([，,、。！？!?；;：:…~～])[ \t]*/gu,'$1')
    .replace(/[，,]{2,}/gu,'，')
    .replace(/、{2,}/gu,'、')
    .replace(/，(?=[。！？!?…~～])/gu,'')
    .replace(/([。！？!?…~～])，/gu,'$1')
    .replace(/[，,、：:\s]+$/u,'')
    .trim()
}
function cueOf(head){
  if(CUES.cry.test(head.replace(COMFORT,'')))return 'cry'
  for(const name of ORDER.slice(1))if(CUES[name].test(head))return name
  return null
}
export function parseVoiceScript(text){
  if(typeof text!=='string')return {spoken:'',clip:null}
  const chars=Array.from(text),head=chars.slice(0,LIMIT).join(''),cue=cueOf(head)
  if(!cue)return {spoken:text,clip:null}
  const tail=chars.slice(LIMIT).join(''),stripped=tidy(head.replace(FILLER,'').replace(SIGH_FILLER,'$1'))
  // Never hand an empty line to the voice service: fall back to the original reply.
  return {spoken:stripped?stripped+tail:text,clip:CLIPS[cue]}
}
