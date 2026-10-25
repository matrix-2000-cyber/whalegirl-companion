import {createFaceObserver,headPose} from './face-rules.mjs'
export function createFaceTracker({video,onState,onReaction}){
  const observer=createFaceObserver();let worker=null,stopped=false,timer=null,loadingTimer=null,inFlight=false,last=-1,frameTimer=null
  function stop(){stopped=true;clearInterval(timer);clearTimeout(loadingTimer);clearTimeout(frameTimer);worker?.terminate();worker=null;observer.reset();onState({code:null,label:'面部动作识别已关闭'})}
  function fail(message){stop();onState({code:null,label:message})}
  async function frame(){
    if(stopped||inFlight||document.hidden||video.readyState<2||!video.videoWidth||video.currentTime===last)return
    inFlight=true;last=video.currentTime
    try{
      const bitmap=await createImageBitmap(video,{resizeWidth:320,resizeHeight:Math.round(video.videoHeight*320/video.videoWidth)})
      if(stopped){bitmap.close();return}
      worker.postMessage({type:'frame',frame:bitmap,time:performance.now()},[bitmap])
      frameTimer=setTimeout(()=>fail('面部动作识别响应超时，可关闭后重开'),10000)
    }catch{fail('面部动作识别无法读取画面')}
  }
  function start(){
    onState({code:null,label:'正在准备本地面部动作识别…'})
    worker=new Worker('/face-worker.js');loadingTimer=setTimeout(()=>fail('面部识别组件加载超时'),45000)
    worker.onerror=()=>fail('面部动作识别组件启动失败')
    worker.onmessage=event=>{
      if(stopped)return
      if(event.data.type==='ready'){clearTimeout(loadingTimer);onState({code:null,label:'面部动作识别已就绪'});timer=setInterval(()=>void frame(),220);void frame();return}
      if(event.data.type==='error'){fail(event.data.message);return}
      if(event.data.type==='result'){
        clearTimeout(frameTimer);inFlight=false
        const state=observer.update(event.data.categories,performance.now(),headPose(event.data.matrix));onState({...state,at:performance.now()})
        if(state.react)onReaction(state)
      }
    }
    worker.postMessage({type:'init'})
  }
  return {start,stop}
}
