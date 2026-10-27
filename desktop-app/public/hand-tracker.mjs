import {fingertipTarget,createWaveDetector} from './hand-rules.mjs'
export function createHandTracker({video,overlay,onGaze,onWave,onStatus,isGazeEnabled=()=>false}){
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
        clearTimeout(loadingTimer);onStatus('可挥手问好；说“看我的手指”后才开启指尖注视')
        timer=setInterval(()=>void capture(),125);void capture();return
      }
      if(event.data.type==='error'){fail(event.data.message);return}
      if(event.data.type!=='result')return
      inFlight=false
      const points=event.data.points,target=fingertipTarget(points),now=performance.now()
      if(target){
        const following=isGazeEnabled()
        lastSeen=now;clearTimeout(lostTimer);onGaze(following?target:null)
        ctx.clearRect(0,0,overlay.width,overlay.height)
        ctx.fillStyle='#64eff2';ctx.strokeStyle='#ffffff';ctx.lineWidth=3
        if(following){ctx.beginPath();ctx.arc(target.x*overlay.width,target.y*overlay.height,8,0,Math.PI*2);ctx.fill();ctx.stroke()}
        onStatus(following?'看到你的手了 · 正在执行指尖注视':'已识别手势 · 需要注视时请说“看我的手指”')
        if(wave.update(points,now))onWave()
      }else{
        wave.reset();ctx.clearRect(0,0,overlay.width,overlay.height)
        if(now-lastSeen>600){clearTarget();onStatus(isGazeEnabled()?'指尖注视中 · 把食指放回画面即可':'等待手势 · 说“看我的手指”才会注视')}
        else{clearTimeout(lostTimer);lostTimer=setTimeout(clearTarget,650)}
      }
    }
    worker.postMessage({type:'init'})
  }
  return {start,stop}
}
