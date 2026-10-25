const clamp=x=>Math.max(0,Math.min(1,x))
export function expressionMotion(kind,elapsed,duration=3200){
  const weight=clamp(elapsed/180)*clamp((duration-elapsed)/400),t=Math.max(0,elapsed)/1000
  return {weight,
    tilt:weight*(kind==='curious'?-.035:kind==='concern'?.018:kind==='shake'?Math.sin(t*12)*.03:0),
    nod:weight*(kind==='nod'?Math.sin(Math.min(1,t/1.2)*Math.PI*2)*3:kind==='sigh'?Math.sin(Math.min(1,t/2)*Math.PI)*2:0),
    cheek:kind==='smile'?weight:0,
    tears:kind==='cry'?weight:0,
    brow:kind==='concern'?weight:0,
  }
}
