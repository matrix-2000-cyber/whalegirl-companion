export function requiresCurrentFrame(text){return /(?:现在|此刻).*(?:看|穿|拿|手|脸|表情|什么)|(?:手里|手上|拿着|穿着|这是什么|几个手指|看清|看一下|看看我)/u.test(text)}
export function createVideoObserver({capture,observe,clear,onState=()=>{},now=Date.now,intervalMs=5000}={}){
  let epoch=0,timer=null,controller=null,observation=null,clearing=Promise.resolve()
  async function tick(lease){
    if(lease!==epoch)return
    let captured=false
    try{
      await clearing;if(lease!==epoch)return
      const image=capture();captured=true;controller=new AbortController();onState('正在持续分析画面…')
      const result=await observe(image,controller.signal)
      if(lease!==epoch)return
      observation=result.observation||null
      onState(observation?'视觉持续更新 · 她已收到最近画面':'画面分析准备中 · 本地动作识别继续')
    }catch{if(lease===epoch)onState('这次画面暂未看清 · 将继续分析')}
    finally{if(lease===epoch)timer=setTimeout(()=>void tick(lease),captured?intervalMs:250)}
  }
  return {start(){this.stop();const lease=epoch;timer=setTimeout(()=>void tick(lease),400)},stop(){epoch++;clearTimeout(timer);controller?.abort();controller=null;observation=null;clearing=clearing.then(()=>clear?.()).catch(()=>{})},fresh(){return !!observation&&now()-observation.observedAt<=9000},get:()=>observation}
}
