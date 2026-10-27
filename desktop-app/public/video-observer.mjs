export function requiresCurrentFrame(text){return /(?:现在|此刻).*(?:看|穿|拿|手|脸|表情|什么)|(?:手里|手上|拿着|穿着|这是什么|几个手指|看清|看一下|看看我)/u.test(text)}
export function reuseBackgroundVision({initiative=false,hasImage=false,fresh=false,text=''}={}){
  // Cache reuse is only for unsolicited small talk, never a user's new turn.
  return initiative&&hasImage&&fresh&&!requiresCurrentFrame(text)
}
export function prepareTurnVision({image,sharing,capture,initiative,fresh,text}){
  const latest=image&&sharing?capture():undefined
  return {image:latest,useVision:reuseBackgroundVision({initiative,hasImage:!!latest,fresh,text})}
}
export function createVideoObserver({capture,observe,clear,onState=()=>{},now=Date.now,intervalMs=5000,schedule=setTimeout,cancel=clearTimeout}={}){
  let epoch=0,timer=null,controller=null,observation=null,clearing=Promise.resolve()
  async function tick(lease){
    if(lease!==epoch)return
    let captured=false,started=now()
    try{
      await clearing;if(lease!==epoch)return
      const image=capture();started=now();captured=true;controller=new AbortController();onState('正在分析新抓取的画面…')
      const result=await observe(image,controller.signal)
      if(lease!==epoch)return
      observation=result.observation||null
      onState(observation?'后台画面分析已更新 · 对话时另取最新画面':'画面分析准备中 · 本地动作识别继续')
    }catch{if(lease===epoch)onState('这次画面暂未看清 · 将继续分析')}
    finally{if(lease===epoch)timer=schedule(()=>tick(lease),captured?Math.max(250,intervalMs-(now()-started)):250)}
  }
  return {start(){this.stop();const lease=epoch;timer=schedule(()=>tick(lease),400)},stop(){epoch++;cancel(timer);controller?.abort();controller=null;observation=null;clearing=clearing.then(()=>clear?.()).catch(()=>{})},fresh(maxAgeMs=2500){return !!observation&&now()-observation.observedAt>=0&&now()-observation.observedAt<=maxAgeMs},get:()=>observation}
}
