import {createSignalProbe} from './barge-in.mjs'
import {gazeVector,attentiveMotion,blinkPhase,blinkClosure,eyelidShape} from './standing-policy.mjs'
import {createMouthSync,createV1LipTexture,createCleanMouthPatch,drawSpeechMouth} from './mouth-sync.mjs'
export function mouthFrame(energy,playing){
  if(!playing||!Number.isFinite(energy)||energy<.012)return 0
  return energy<.065?1:2
}
export function createAvatar({canvas,player}){
  // Keep the same 640 x 360 layout; render eye curves at twice the resolution.
  canvas.width=1280;canvas.height=720
  const ctx=canvas.getContext('2d'),front=new Image()
  const reduced=matchMedia('(prefers-reduced-motion: reduce)')
  let ready=false,raf=0,last=0,disposed=false
  let gazeTarget=null,gazeX=0,gazeY=0,gazeEnabled=false
  let nextBlink=performance.now()+2800,blinkStart=-Infinity,blinkRate=1
  let output=null,audioAnalyser=null,audioData=null,unlocking=null,voiceProbe=null
  const hairLayers=new Map()
  const lipSync=createMouthSync(),sheet=new Image()
  let lipTexture=null,mouthPatch=null
  sheet.onload=()=>{lipTexture=createV1LipTexture(sheet)}
  sheet.src='/whalegirl-seated-atlas.png'
  front.src='/standing/front.png'
  front.onload=()=>{mouthPatch=createCleanMouthPatch(front);ready=true;canvas.dataset.ready='true';start()}
  front.onerror=()=>{canvas.dataset.ready='false';canvas.setAttribute('aria-label','人物暂时没加载，请刷新页面')}
  async function unlockAudio(){
    if(unlocking)return unlocking
    unlocking=(async()=>{
      try{
        const Audio=window.AudioContext||window.webkitAudioContext
        if(!Audio)return
        if(!output)output=new Audio()
        if(output.state==='suspended')await output.resume()
        if(output.state!=='running'||audioAnalyser)return
        const source=output.createMediaElementSource(player)
        audioAnalyser=output.createAnalyser();audioAnalyser.fftSize=2048;audioAnalyser.smoothingTimeConstant=.25
        audioData=new Float32Array(audioAnalyser.fftSize)
        voiceProbe=createSignalProbe(audioAnalyser,output.sampleRate)
        source.connect(audioAnalyser);audioAnalyser.connect(output.destination)
      }catch{/* Ordinary audio playback remains available without Web Audio. */}
    })().finally(()=>{unlocking=null})
    return unlocking
  }
  function drawEye(cx,cy,eyeIndex,phase,closure){
    if(phase!=='open'&&closure>0){
      ctx.save();ctx.globalAlpha=Math.min(1,closure/.12);ctx.beginPath();ctx.ellipse(cx,cy-1,18,18,0,0,Math.PI*2);ctx.clip()
      // Preserve the frontal iris at its original size; only the aperture moves.
      const skin=ctx.createLinearGradient(0,cy-19,0,cy+15)
      skin.addColorStop(0,'#f1dbd5');skin.addColorStop(1,'#f4d5c9')
      ctx.fillStyle=skin;ctx.fillRect(cx-18,cy-19,36,36)
      const p=Math.max(0,Math.min(1,closure)),{span,left,right,upper,lower}=eyelidShape(p)
      if(p<1){
        ctx.save();ctx.beginPath();ctx.moveTo(cx-span,cy+left)
        ctx.quadraticCurveTo(cx,cy+upper,cx+span,cy+right)
        ctx.quadraticCurveTo(cx,cy+lower,cx-span,cy+left);ctx.closePath();ctx.clip()
        ctx.drawImage(front,cx-18,cy-18,36,36,cx-18+gazeX*3.2,cy-18+gazeY*2,36,36)
        ctx.restore()
      }
      // One lid throughout the blink: stable width and a gently lifted lower lid.
      ctx.strokeStyle='#452b32';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round'
      ctx.beginPath();ctx.moveTo(cx-span,cy+left)
      ctx.quadraticCurveTo(cx,cy+upper,cx+span,cy+right);ctx.stroke()
      ctx.restore()
      // Restore the original blue fringe around the socket, excluding the iris.
      if(!hairLayers.has(eyeIndex)){
        const layer=document.createElement('canvas');layer.width=40;layer.height=40
        const layerCtx=layer.getContext('2d');layerCtx.drawImage(front,cx-20,cy-20,40,40,0,0,40,40)
        const pixels=layerCtx.getImageData(0,0,40,40)
        const connected=new Uint8Array(1600),queue=[]
        const visit=(x,y)=>{
          if(x<0||y<0||x>=40||y>=40)return
          const index=y*40+x,i=index*4,dx=x-20,dy=y-21
          if(connected[index]||dx*dx/(13*13)+dy*dy/(14*14)<1||pixels.data[i+2]<=pixels.data[i]+8)return
          connected[index]=1;queue.push([x,y])
        }
        for(let n=0;n<40;n++){visit(n,0);visit(n,39);visit(0,n);visit(39,n)}
        for(let n=0;n<queue.length;n++){const [x,y]=queue[n];visit(x-1,y);visit(x+1,y);visit(x,y-1);visit(x,y+1)}
        for(let y=0;y<40;y++)for(let x=0;x<40;x++){
          const i=(y*40+x)*4
          if(!connected[y*40+x])pixels.data[i+3]=0
        }
        layerCtx.putImageData(pixels,0,0);hairLayers.set(eyeIndex,layer)
      }
      ctx.drawImage(hairLayers.get(eyeIndex),cx-20,cy-20);return
    }
    if(Math.abs(gazeX)<.012&&Math.abs(gazeY)<.012)return
    ctx.save();ctx.beginPath();ctx.ellipse(cx,cy,12.5,12,0,0,Math.PI*2);ctx.clip()
    const white=ctx.createLinearGradient(0,cy-13,0,cy+13);white.addColorStop(0,'#e6e7f0');white.addColorStop(1,'#fff8f0')
    ctx.fillStyle=white;ctx.fillRect(cx-14,cy-14,28,28)
    ctx.drawImage(front,cx-9,cy-11,18,24,cx-9+gazeX*3.2,cy-11+gazeY*2,18,24);ctx.restore()
  }
  function drawBreathingPose(motion){
    // The head follows the chest slightly, while the soles never leave the floor.
    const knots=[[0,motion.y],[218,motion.y],[264,motion.chestY],[308,motion.y*.15],[330,0],[360,0]]
    for(let i=0;i<knots.length-1;i++){
      const [top,dy]=knots[i],[bottom,endDy]=knots[i+1]
      ctx.drawImage(front,0,top,640,bottom-top,0,top+dy,640,bottom-top+endDy-dy)
    }
  }
  function paint(now){
    raf=0;if(document.hidden||!ready||disposed)return
    if(now-last<16){raf=requestAnimationFrame(paint);return}last=now
    const playing=!player.paused&&!player.ended&&player.readyState>=2
    let energy=0,bands=[]
    if(playing&&audioAnalyser&&output.state==='running'){
      audioAnalyser.getFloatTimeDomainData(audioData);let sum=0;for(const x of audioData)sum+=x*x;energy=Math.sqrt(sum/audioData.length)
      bands=voiceProbe?.().bands||[]
    }
    const articulation=lipSync.update({playing,rms:energy,bands,now,mediaTime:player.currentTime})
    const mouth=mouthFrame(energy,playing)
    const target=gazeVector(gazeTarget);gazeX+=(target.x-gazeX)*.15;gazeY+=(target.y-gazeY)*.15
    if(!gazeTarget&&Math.abs(gazeX)<.001&&Math.abs(gazeY)<.001){gazeX=0;gazeY=0}
    if(now>=nextBlink){blinkStart=now;blinkRate=1;nextBlink=now+3500+Math.random()*1800}
    const eyePhase=blinkPhase((now-blinkStart)/blinkRate),blink=eyePhase!=='open'
    const motion=attentiveMotion(now,{reduced:reduced.matches})
    canvas.dataset.mode='attentive';canvas.dataset.pose='front'
    canvas.dataset.action='';canvas.dataset.expression='neutral';canvas.dataset.animationSet='idle-and-audio-mouth'
    canvas.dataset.speechAnimation=articulation.active?'v1-audio-mouth':'none'
    canvas.dataset.jaw=articulation.jaw.toFixed(3);canvas.dataset.mouthSpread=articulation.spread.toFixed(3)
    canvas.dataset.audioRms=energy.toFixed(4);canvas.dataset.lipSync=audioAnalyser?'audio-envelope-spectrum':'unavailable'
    canvas.dataset.gazeX=gazeX.toFixed(3);canvas.dataset.gazeY=gazeY.toFixed(3)
    canvas.dataset.mouth=String(mouth);canvas.dataset.blink=String(blink);canvas.dataset.playing=String(playing)
    canvas.dataset.blinkPhase=eyePhase;canvas.dataset.blinkStyle='continuous-natural-lid';canvas.dataset.headSource='front';canvas.dataset.gazeEnabled=String(gazeEnabled);canvas.dataset.breath=motion.breath.toFixed(3);canvas.dataset.headLift=motion.y.toFixed(3);canvas.dataset.chestLift=motion.chestY.toFixed(3);canvas.dataset.feetLift='0';canvas.dataset.tilt='0'
    ctx.setTransform(2,0,0,2,0,0)
    ctx.clearRect(0,0,640,360)
    ctx.save();ctx.fillStyle='#0b140b42';ctx.beginPath();ctx.ellipse(320,331,52,4,0,0,Math.PI*2);ctx.fill();ctx.restore()
    {
      ctx.save()
      drawBreathingPose(motion);ctx.translate(0,motion.y)
      const elapsed=(now-blinkStart)/blinkRate
      const closure=blinkClosure(elapsed)
      canvas.dataset.blinkClosure=closure.toFixed(1)
      drawEye(292,190,0,eyePhase,closure);drawEye(342,188,1,eyePhase,closure)
      // Keep original brows and fringe pinned to the same head/breathing pose.
      ctx.drawImage(front,260,145,112,26,260,145,112,26)
      drawSpeechMouth(ctx,articulation,lipTexture,mouthPatch)
      ctx.restore()
    }
    raf=requestAnimationFrame(paint)
  }
  function start(){if(!raf&&!document.hidden&&ready&&!disposed)raf=requestAnimationFrame(paint)}
  function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0}else start()}
  document.addEventListener('visibilitychange',visibility)
  return {
    unlockAudio,
    voiceSample(){return voiceProbe?{...voiceProbe(),playing:!player.paused&&!player.ended}:null},
    setInteraction(){},
    setGazeEnabled(enabled){const next=!!enabled;gazeEnabled=next;if(!next)gazeTarget=null},
    setGaze(target){gazeTarget=gazeEnabled&&target&&Number.isFinite(target.x)&&Number.isFinite(target.y)?{x:Math.max(0,Math.min(1,target.x)),y:Math.max(0,Math.min(1,target.y))}:null},
    blink({slow=false}={}){blinkStart=performance.now();blinkRate=slow?12:1;nextBlink=blinkStart+4500},
    // Compatibility hooks: perception and speech still call these, but no extra
    // character animation may replace the idle body and audio-driven mouth.
    express(){},
    greet(){},
    action(){return false},
    resetAction(){},
    destroy(){disposed=true;cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',visibility);void output?.close()},
  }
}
