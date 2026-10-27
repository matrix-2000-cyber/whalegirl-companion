export const STANDING_ACTIONS=Object.freeze({
  wave:{file:'wave.webm',priority:3,ttl:18000},
  smile:{file:'smile.webm',priority:1,ttl:60000},
  sigh:{file:'sigh.webm',priority:1,ttl:60000},
  shy:{file:'shy.webm',priority:1,ttl:30000},
  bow:{file:'bow.webm',priority:2,ttl:18000},
})
export function gazeVector(target){
  if(!target||!Number.isFinite(target.x)||!Number.isFinite(target.y))return {x:0,y:0}
  const unit=n=>Math.max(0,Math.min(1,n))
  return {x:(unit(target.x)-.5)*2,y:(unit(target.y)-.5)*2}
}
export function attentiveMotion(now,{reduced=false}={}){
  const phase=((now/5100+.018*Math.sin(now/17000))%1+1)%1
  const breath=reduced?0:phase<.42?(1-Math.cos(Math.PI*phase/.42))/2:(1+Math.cos(Math.PI*(phase-.42)/.58))/2
  return {x:0,y:breath?-1.5*breath:0,chestY:breath?-2.8*breath:0,feetY:0,breath,tilt:0,gazeX:0,gazeY:0}
}
// Phase labels for the continuous close, hold, and reopen animation.
export function blinkPhase(elapsed){
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=220)return 'open'
  return elapsed<65||elapsed>=105?'half':'closed'
}
// Fast close, brief contact, relaxed reopen. The same curve is used in both directions.
export function blinkClosure(elapsed){
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=220)return 0
  const t=elapsed<65?elapsed/65:elapsed<105?1:(220-elapsed)/115
  return (1-Math.cos(Math.PI*t))/2
}
export function eyelidShape(closure){
  const p=Math.max(0,Math.min(1,closure))
  // Both Bezier curves share endpoints; their controls meet without crossing.
  return {span:15,left:-9+12*p,right:-10+12*p,upper:-22+30*p,lower:14-6*p}
}
// No random actions or idle video: every clip requires an explicit scene cue.
export function createStandingPolicy({now=()=>performance.now(),cooldown=12000}={}){
  let pending=null,active=null;const last=new Map()
  return {
    request(kind){
      const cue=STANDING_ACTIONS[kind],time=now()
      if(!cue||active===kind||pending?.kind===kind||time-(last.get(kind)??-Infinity)<cooldown)return false
      if(pending&&pending.expires>=time&&pending.priority>cue.priority)return false
      pending={kind,priority:cue.priority,expires:time+cue.ttl};return true
    },
    tick({busy=false,gaze=false,reduced=false}={}){
      const time=now();if(pending&&pending.expires<time)pending=null
      if(busy||gaze||reduced){const interrupted=!!active;active=null;return {action:null,start:false,interrupted}}
      if(active)return {action:active,start:false,interrupted:false}
      if(!pending)return {action:null,start:false,interrupted:false}
      active=pending.kind;pending=null;last.set(active,time)
      return {action:active,start:true,interrupted:false}
    },
    finish(kind){if(active===kind)active=null},
    reset(){pending=null;active=null},
  }
}
