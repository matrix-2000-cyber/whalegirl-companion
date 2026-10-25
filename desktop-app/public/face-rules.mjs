export const FACE_LABELS={smile:'嘴角上扬，可能在微笑',brow:'眉部收紧',raisedBrows:'眉毛抬起',downturned:'嘴角下压',mouthOpen:'嘴巴张开',eyesClosed:'持续闭眼',nod:'点头',shake:'摇头',neutral:'面部动作平稳'}
export function headPose(matrix){
  if(!matrix||matrix.length!==16||!Array.from(matrix).every(Number.isFinite))return null
  return {pitch:Math.atan2(matrix[6],matrix[10]),yaw:Math.atan2(-matrix[2],Math.hypot(matrix[0],matrix[1]))}
}
function createHeadObserver(){
  let base=null,cycle=null,last=-Infinity
  return {reset(){base=null;cycle=null;last=-Infinity},update(pose,now){
    if(!pose||!Number.isFinite(pose.pitch)||!Number.isFinite(pose.yaw)){cycle=null;return null}
    if(!base){base={...pose};return null}
    const p=pose.pitch-base.pitch,y=pose.yaw-base.yaw
    if(Math.abs(p)>.65||Math.abs(y)>.65){cycle=null;return null}
    if(now-last<4000){base.pitch+=p*.025;base.yaw+=y*.025;return null}
    if(!cycle){
      if(Math.abs(p)>.14&&Math.abs(p)>Math.abs(y)*1.4)cycle={kind:'nod',axis:'pitch',sign:Math.sign(p),at:now,opposite:false}
      else if(Math.abs(y)>.16&&Math.abs(y)>Math.abs(p)*1.4)cycle={kind:'shake',axis:'yaw',sign:Math.sign(y),at:now,opposite:false}
      else {base.pitch+=p*.015;base.yaw+=y*.015}
      return null
    }
    if(now-cycle.at>1800){cycle=null;return null}
    const value=pose[cycle.axis]-base[cycle.axis]
    if(value*cycle.sign<-.13)cycle.opposite=true
    if(Math.abs(value)<.055&&now-cycle.at>=180&&(cycle.kind==='nod'||cycle.opposite)){
      const kind=cycle.kind;cycle=null;last=now;return kind
    }
    return null
  }}
}
export function createFaceObserver(){
  let smooth={},baseline={},calibration=0,candidate=null,since=0,lastReaction=-Infinity,armed=true
  const head=createHeadObserver()
  function clear(){smooth={};baseline={};calibration=0;candidate=null;head.reset();armed=true}
  return {update(categories,now,pose=null){
    if(!Array.isArray(categories)||!categories.length){clear();return {code:null,label:'未检测到清晰面部',react:false}}
    const scores=Object.fromEntries(categories.filter(c=>typeof c.categoryName==='string'&&Number.isFinite(c.score)).map(c=>[c.categoryName,Math.max(0,Math.min(1,c.score))]))
    for(const key of new Set([...Object.keys(smooth),...Object.keys(scores)]))smooth[key]=(smooth[key]??scores[key]??0)*.65+(scores[key]||0)*.35
    const avg=(a,b)=>((smooth[a]||0)+(smooth[b]||0))/2
    const smile=avg('mouthSmileLeft','mouthSmileRight'),brow=avg('browDownLeft','browDownRight'),frown=avg('mouthFrownLeft','mouthFrownRight')
    const raised=Math.max(smooth.browInnerUp||0,avg('browOuterUpLeft','browOuterUpRight'))
    // Only low-expression samples enter the session baseline.
    if(calibration<20&&Math.max(smile,brow,frown,raised,smooth.jawOpen||0)<.3&&avg('eyeBlinkLeft','eyeBlinkRight')<.3){
      for(const [key,value] of Object.entries(smooth))baseline[key]=((baseline[key]||0)*calibration+value)/(calibration+1)
      calibration++
    }
    const relative=(value,a,b,min)=>value>Math.max(min,((baseline[a]||0)+(baseline[b]||0))/2+.22)
    const code=avg('eyeBlinkLeft','eyeBlinkRight')>.65?'eyesClosed':relative(smile,'mouthSmileLeft','mouthSmileRight',.45)?'smile':relative(brow,'browDownLeft','browDownRight',.4)?'brow':relative(frown,'mouthFrownLeft','mouthFrownRight',.4)?'downturned':raised>Math.max(.45,(baseline.browInnerUp||0)+.25)?'raisedBrows':(smooth.jawOpen||0)>.4?'mouthOpen':'neutral'
    if(candidate!==code){candidate=code;since=now}
    const duration=now-since,ready=duration>=(code==='neutral'?300:code==='eyesClosed'?1800:750)
    if(ready&&code==='neutral')armed=true
    const gesture=head.update(pose,now),action=gesture||(ready?code:null)
    const expressible=action&&!['neutral','mouthOpen'].includes(action)
    const react=!!(expressible&&(armed||gesture)&&now-lastReaction>20000)
    if(react){lastReaction=now;armed=false}
    return {code:action,label:action?FACE_LABELS[action]:'正在观察面部动作',react,durationMs:duration,calibrated:calibration>=12}
  },reset(){clear();lastReaction=-Infinity}}
}
