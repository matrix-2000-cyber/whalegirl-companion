export function faceResponse(code,{userText='',variant=0}={}){
  const demonstrating=/测试|演示|表演|故意|没生气|没有生气/.test(userText)
  const replies={
    smile:{expression:'smile',text:/难过|难受|伤心/.test(userText)?'嘿嘿，鲸鲸陪你慢慢聊。':['嘿嘿，有什么开心事呀？','嘿嘿，想分享给鲸鲸听吗？'][variant%2]},
    brow:{expression:'concern',text:demonstrating?'看到你皱眉的动作啦。':'有什么想和鲸鲸说的吗？'},
    raisedBrows:{expression:'curious',text:demonstrating?'鲸鲸看到你抬眉啦。':'发现什么有趣的事了吗？'},
    downturned:{expression:'concern',text:demonstrating?'看到嘴角的变化啦。':'鲸鲸在呢，想聊聊吗？'},
    eyesClosed:{expression:'attentive',text:'想歇一会儿，还是继续聊？'},
    nod:{expression:'nod',text:'嗯嗯，鲸鲸在听呢。'},
    shake:{expression:'curious',text:'看到你摇头啦，想说什么？'},
  }
  return replies[code]||null
}
export function replyExpression(text){
  if(/(?:别|不要|不)哭|难过|难受|伤心|抱抱|陪着你/.test(text))return 'concern'
  if(/呜呜|😭|我哭/.test(text))return 'cry'
  if(/哈哈|嘿嘿|开心|好耶|太棒/.test(text))return 'smile'
  if(/唉|叹气/.test(text))return 'sigh'
  return /[？?]/.test(text)?'curious':'attentive'
}
export function createReactionGate({now=Date.now,cooldown=15000}={}){
  let last=-Infinity
  return {ready:()=>now()-last>=cooldown,claim(){if(now()-last<cooldown)return false;last=now();return true},mark(){last=now()}}
}
