const tags={cry_1:'(crying)',laugh_1:'(chuckle)',sigh_1:'(sighs)',happy_1:'(chuckle)'}
export function paidVoiceScript(text,script){
  const tag=tags[script.clip]
  if(!tag)return text
  const onlySound=/^[\s哈嘿嘻呵呜唉哎5T_哭泣😭😢。！，、…~～!?]+$/u.test(text)
  return onlySound?tag:tag+' '+script.spoken
}
