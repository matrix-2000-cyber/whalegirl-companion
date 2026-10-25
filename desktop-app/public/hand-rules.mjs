const clamp=n=>Math.max(0,Math.min(1,n))
export function fingertipTarget(points){
  const tip=points?.[8]
  if(!tip||!Number.isFinite(tip.x)||!Number.isFinite(tip.y))return null
  return {x:1-clamp(tip.x),y:clamp(tip.y)}
}
export function openPalm(points){
  if(!points||points.length!==21)return false
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)
  // Wrist-relative distances work even when the hand is tilted sideways.
  return [8,12,16,20].filter(tip=>distance(points[tip],points[0])>distance(points[tip-2],points[0])*1.2).length>=3
}
export function createWaveDetector(){
  let samples=[],lastWave=-Infinity
  return {update(points,now){
    if(!openPalm(points)){samples=[];return false}
    const x=(points[0].x+points[9].x)/2
    samples.push({x,now});samples=samples.filter(s=>now-s.now<1500)
    if(now-lastWave<12000||samples.length<6)return false
    let pivot=samples[0].x,dir=0,reversals=0,min=x,max=x
    for(const s of samples){
      min=Math.min(min,s.x);max=Math.max(max,s.x)
      const delta=s.x-pivot
      if(Math.abs(delta)<.045)continue
      const next=Math.sign(delta)
      if(dir&&dir!==next)reversals++
      dir=next;pivot=s.x
    }
    if(max-min<.14||reversals<2||now-samples[0].now<350)return false
    lastWave=now;samples=[];return true
  },reset(){samples=[]}}
}
