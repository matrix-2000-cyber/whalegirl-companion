// Six aligned faces from the generated atlas; audio stays in the browser.
import {expressionMotion} from './avatar-motion.mjs'
import {createSignalProbe} from './barge-in.mjs'
export function mouthFrame(energy,playing){
  if(!playing||!Number.isFinite(energy)||energy<0.012)return 0
  return energy<0.065?1:2
}
const sources=[38,518,998]
export function createAvatar({canvas,player}){
  const ctx=canvas.getContext('2d'),sheet=new Image()
  const reduced=matchMedia('(prefers-reduced-motion: reduce)')
  let ready=false,raf=0,last=0,mouth=0,lastMouth=0,smooth=0
  let nextBlink=performance.now()+2800,blinkEnd=0
  let output=null,audioAnalyser=null,audioData=null,unlocking=null
  let gazeTarget=null,gazeX=0,gazeY=0,greetUntil=0
  let expression=null,expressionUntil=0,expressionStart=0,voiceProbe=null
  sheet.src='/whalegirl-seated-atlas.png'
  sheet.onload=()=>{ready=true;canvas.dataset.ready='true';start()}
  sheet.onerror=()=>{canvas.dataset.ready='false';canvas.setAttribute('aria-label','鲸鱼娘形象暂时没加载，请刷新页面')}
  async function unlockAudio(){
    if(unlocking)return unlocking
    unlocking=(async()=>{
      try{
        const Audio=window.AudioContext||window.webkitAudioContext
        if(!Audio)return
        if(!output)output=new Audio()
        if(output.state==='suspended')await output.resume()
        // Do not reroute the player unless the output device is running.
        if(output.state!=='running'||audioAnalyser)return
        const source=output.createMediaElementSource(player)
        audioAnalyser=output.createAnalyser();audioAnalyser.fftSize=512
        audioData=new Float32Array(audioAnalyser.fftSize)
        voiceProbe=createSignalProbe(audioAnalyser,output.sampleRate)
        source.connect(audioAnalyser);audioAnalyser.connect(output.destination)
      }catch{/* Browsers without Web Audio retain ordinary audio playback. */}
    })().finally(()=>{unlocking=null})
    return unlocking
  }
  function paint(now){
    raf=0
    if(document.hidden||!ready)return
    if(now-last<33){raf=requestAnimationFrame(paint);return}
    last=now
    const playing=!player.paused&&!player.ended&&player.readyState>=2
    let energy=0
    if(playing&&audioAnalyser&&output.state==='running'){
      audioAnalyser.getFloatTimeDomainData(audioData)
      let sum=0;for(const x of audioData)sum+=x*x
      energy=Math.sqrt(sum/audioData.length)
    }else if(playing){
      // Graceful animation fallback where audio analysis is unavailable.
      energy=Math.max(0,Math.sin(player.currentTime*19))*0.09
    }
    smooth=playing?smooth*.5+energy*.5:0
    if(now-lastMouth>70){mouth=mouthFrame(smooth,playing);lastMouth=now}
    if(!playing)mouth=0
    if(now>=nextBlink){blinkEnd=now+145;nextBlink=now+2800+Math.random()*2400}
    if(now>expressionUntil)expression=null
    const motion=expressionMotion(expression,now-expressionStart,expressionUntil-expressionStart)
    const blink=now<blinkEnd||(expression==='smile'&&now%1500<550)
    canvas.dataset.expression=expression||'neutral'
    const targetX=gazeTarget?(gazeTarget.x-.5)*2:0,targetY=gazeTarget?(gazeTarget.y-.5)*2:0
    gazeX+=(targetX-gazeX)*.13;gazeY+=(targetY-gazeY)*.13
    canvas.dataset.gazeX=gazeX.toFixed(2);canvas.dataset.gazeY=gazeY.toFixed(2)
    canvas.dataset.mouth=String(mouth);canvas.dataset.blink=String(blink);canvas.dataset.playing=String(playing)
    ctx.clearRect(0,0,512,512)
    ctx.save()
    if(!reduced.matches){
      const breath=Math.sin(now/1100)
      ctx.translate(256,494);ctx.rotate(Math.sin(now/1900)*.006+motion.tilt+gazeX*.01)
      ctx.scale(1+breath*.003,1+breath*.006);ctx.translate(-256,-494-breath*1.5)
      ctx.translate(0,motion.nod)
    }
    if(now<greetUntil&&!reduced.matches){ctx.translate(0,Math.sin((1800-greetUntil+now)/1800*Math.PI*2)*2.5)}
    // The character moves above the desktop; desk and book stay fixed below.
    ctx.drawImage(sheet,sources[mouth],blink?512:0,512,370,0,0,512,370)
    if(!blink&&(Math.abs(gazeX)>.015||Math.abs(gazeY)>.015)){
      // Keep the painted eyelids fixed; move each iris inside its eye opening.
      for(const [x,sourceX] of [[212,232],[302,322]]){
        ctx.save();ctx.beginPath();ctx.ellipse(x,230,20,16,0,0,Math.PI*2);ctx.clip()
        const white=ctx.createLinearGradient(0,214,0,246);white.addColorStop(0,'#dbe3f2');white.addColorStop(1,'#fff5f1')
        ctx.fillStyle=white;ctx.fillRect(x-22,212,44,38)
        ctx.translate(gazeX*7,gazeY*4.5)
        ctx.beginPath();ctx.ellipse(x,230,16.5,18,0,0,Math.PI*2);ctx.clip()
        ctx.drawImage(sheet,sourceX,212,36,36,x-18,212,36,36);ctx.restore()
      }
    }
    if(motion.cheek){
      ctx.save();ctx.globalAlpha=motion.cheek*.35
      for(const x of [188,332]){const blush=ctx.createRadialGradient(x,257,1,x,257,17);blush.addColorStop(0,'#f38da2');blush.addColorStop(1,'#f38da200');ctx.fillStyle=blush;ctx.fillRect(x-18,240,36,34)}
      ctx.restore()
    }
    if(motion.brow){
      ctx.save();ctx.globalAlpha=motion.brow*.55;ctx.strokeStyle='#485c7f';ctx.lineWidth=2;ctx.lineCap='round'
      for(const [x,sign] of [[212,1],[302,-1]]){ctx.beginPath();ctx.moveTo(x-11,205+sign*2);ctx.quadraticCurveTo(x,201,x+11,205-sign*2);ctx.stroke()}
      ctx.restore()
    }
    if(motion.tears){
      ctx.fillStyle='#a8deeecc';ctx.globalAlpha=motion.tears
      for(const x of [226,319]){const y=252+(now%1000)/90;ctx.beginPath();ctx.ellipse(x,y,3,7,0,0,Math.PI*2);ctx.fill()}
    }
    ctx.restore()
    ctx.drawImage(sheet,46,370,486,142,8,370,486,142)
    raf=requestAnimationFrame(paint)
  }
  function start(){if(!raf&&!document.hidden&&ready)raf=requestAnimationFrame(paint)}
  function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0}else start()}
  document.addEventListener('visibilitychange',visibility)
  return {unlockAudio,voiceSample(){return voiceProbe?{...voiceProbe(),playing:!player.paused&&!player.ended}:null},express(kind){if(!['cry','smile','sigh','concern','curious','attentive','nod','shake'].includes(kind))return;expression=kind;expressionStart=performance.now();expressionUntil=expressionStart+(kind==='nod'||kind==='shake'?1600:3200)},setGaze(target){gazeTarget=target&&Number.isFinite(target.x)&&Number.isFinite(target.y)?{x:Math.max(0,Math.min(1,target.x)),y:Math.max(0,Math.min(1,target.y))}:null},greet(){greetUntil=performance.now()+1800},destroy(){cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',visibility);void output?.close()}}
}
