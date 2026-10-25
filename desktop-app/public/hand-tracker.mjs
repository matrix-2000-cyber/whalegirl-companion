import {fingertipTarget,createWaveDetector} from './hand-rules.mjs'
export function createHandTracker({video,overlay,onGaze,onWave,onStatus}){
  let worker=null,stopped=false,timer=null,loadingTimer=null,inFlight=false,lastVideoTime=-1
  const wave=createWaveDetector(),ctx=overlay.getContext('2d')
  let lastSeen=0,lostTimer=null
  function clearTarget(){ctx.clearRect(0,0,overlay.width,overlay.height);onGaze(null)}
  function stop(){stopped=true;clearTimeout(loadingTimer);clearTimeout(lostTimer);clearInterval(timer);worker?.terminate();worker=null;clearTarget()}
  function fail(message){stop();onStatus(message)}
  async function capture(){
    if(stopped||inFlight||document.hidden||video.readyState<2||!video.videoWidth||video.currentTime===lastVideoTime)return
    inFlight=true;lastVideoTime=video.currentTime
    try{
      const bitmap=await createImageBitmap(video,{resizeWidth:480,resizeHeight:Math.round(480*video.videoHeight/video.videoWidth)})
      if(stopped){bitmap.close();return}
      worker.postMessage({type:'frame',frame:bitmap,time:performance.now()},[bitmap])
    }catch{inFlight=false;fail('当前浏览器无法追踪手指，请用 Edge 重试')}
  }
  function start(){
    onStatus('正在准备本地手势识别…')
    if(!window.Worker||!window.createImageBitmap){fail('当前浏览器不支持手势追踪，摄像头仍可使用');return}
    worker=new Worker('/hand-worker.js')
    loadingTimer=setTimeout(()=>fail('手势组件加载超时，请关闭摄像头后重试'),45000)
    worker.onerror=()=>fail('手势组件启动失败，摄像头仍可使用')
    worker.onmessage=event=>{
      if(stopped)return
      if(event.data.type==='ready'){
        clearTimeout(loadingTimer);onStatus('把食指放进画面，她会看过去；张开手掌左右挥动可打招呼')
        timer=setInterval(()=>void capture(),125);void capture();return
      }
      if(event.data.type==='error'){fail(event.data.message);return}
      if(event.data.type!=='result')return
      inFlight=false
      const points=event.data.points,target=fingertipTarget(points),now=performance.now()
      if(target){
        lastSeen=now;clearTimeout(lostTimer);onGaze(target)
        ctx.clearRect(0,0,overlay.width,overlay.height)
        ctx.fillStyle='#64eff2';ctx.strokeStyle='#ffffff';ctx.lineWidth=3
        ctx.beginPath();ctx.arc(target.x*overlay.width,target.y*overlay.height,8,0,Math.PI*2);ctx.fill();ctx.stroke()
        onStatus('看到你的手了 · 眼睛正在跟随食指')
        if(wave.update(points,now))onWave()
      }else{
        wave.reset();ctx.clearRect(0,0,overlay.width,overlay.height)
        if(now-lastSeen>600){clearTarget();onStatus('手暂时离开画面了，再伸出食指试试')}
        else{clearTimeout(lostTimer);lostTimer=setTimeout(clearTarget,650)}
      }
    }
    worker.postMessage({type:'init'})
  }
  return {start,stop}
}
