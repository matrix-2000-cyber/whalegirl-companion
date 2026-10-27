const clamp=(n,low=0,high=1)=>Math.max(low,Math.min(high,n))

// Audio-driven articulation, not a repeating animation or a phoneme transcript.
// A short attack/release follows syllables without chattering between frames.
export function createMouthSync(){
  let jaw=0,spread=.5,lastTime=null,lastMediaTime=null,stalledFor=0,peak=.08
  return {
    update({playing=false,rms=0,bands=[],now=0,mediaTime=0}={}){
      const dt=lastTime===null?16:clamp(now-lastTime,0,100)
      lastTime=now
      if(!playing){jaw=0;lastMediaTime=null;stalledFor=0;return {jaw:0,spread:.5,active:false}}
      stalledFor=mediaTime===lastMediaTime?stalledFor+dt:0;lastMediaTime=mediaTime
      const level=Number.isFinite(rms)?Math.max(0,rms):0
      peak=Math.max(.045,level,peak*Math.exp(-dt/1400))
      const voiced=level>.007&&stalledFor<100
      const target=voiced?clamp((level-.006)/Math.max(.03,peak-.006))**.65:0
      const approach=1-Math.exp(-dt/(target>jaw?24:38))
      jaw+=(target-jaw)*approach
      if(!voiced&&jaw<.035)jaw=0
      const power=bands.map(n=>Number.isFinite(n)?Math.max(0,n)**2:0)
      const low=(power[1]||0)+(power[2]||0)
      const high=(power[3]||0)+(power[4]||0)
      const bright=low+high>1e-10?clamp(high/(low+high)*1.6):.5
      spread+=(bright-spread)*(1-Math.exp(-dt/65))
      return {jaw,spread,active:voiced||jaw>.035}
    },
  }
}

// Reuse the lip shading in v1's seated atlas, removing its surrounding skin.
export function createV1LipTexture(sheet){
  const layer=document.createElement('canvas');layer.width=29;layer.height=24
  const ctx=layer.getContext('2d',{willReadFrequently:true})
  ctx.drawImage(sheet,1241,247,29,24,0,0,29,24)
  const pixels=ctx.getImageData(0,0,29,24)
  for(let i=0;i<pixels.data.length;i+=4){
    const red=pixels.data[i],green=pixels.data[i+1]
    pixels.data[i+3]*=clamp((red-green-32)/22)
  }
  ctx.putImageData(pixels,0,0);return layer
}

export function createCleanMouthPatch(front){
  const layer=document.createElement('canvas');layer.width=20;layer.height=16
  const ctx=layer.getContext('2d',{willReadFrequently:true})
  ctx.drawImage(front,307,198,20,16,0,0,20,16)
  const pixels=ctx.getImageData(0,0,20,16),original=pixels.data.slice()
  // Interpolate adjacent skin only over the tiny original closed-mouth mark.
  for(let y=3;y<13;y++)for(let x=5;x<16;x++){
    const weight=clamp((1-Math.hypot((x-10.5)/4.5,(y-7.8)/3.8))*3)
    const i=(y*20+x)*4,left=(y*20+4)*4,right=(y*20+16)*4,t=(x-4)/12
    for(let c=0;c<3;c++)pixels.data[i+c]=original[i+c]*(1-weight)+(original[left+c]*(1-t)+original[right+c]*t)*weight
  }
  ctx.putImageData(pixels,0,0);return layer
}

export function drawSpeechMouth(ctx,{jaw,spread},texture,patch){
  if(jaw<=.035||!texture||!patch)return
  ctx.drawImage(patch,307,198)
  // Anchor the upper lip and let the lower lip open; keep it on the same face.
  const width=4.2+jaw*(3.2+spread*2.2),height=.9+jaw*5.8
  ctx.drawImage(texture,0,0,29,24,317.5-width/2,203.8,width,height)
}
