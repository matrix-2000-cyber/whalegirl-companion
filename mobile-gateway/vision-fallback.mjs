// These failures occur before agent.followup(), so text-only continuation is safe.
// Never replay on network timeouts or uncertain conversation failures.
const beforeTurnFailures=new Set(['画面识别没有返回内容','画面识别失败，请稍后再试','视觉服务尚未配置，请先用语音聊天'])
export async function withVisionFallback(input,request){
  const result=await request(input)
  if(result.ok)return result
  if(!input.image||!beforeTurnFailures.has(result.error))throw Error(result.error||'电脑端服务不可用')
  const note='[本轮画面识别失败，请只根据用户文字回答；不要猜测画面内容。]\n'
  if(Array.from(note+input.text).length>2000)throw Error(result.error)
  const {image,...textOnly}=input
  const continued=await request({...textOnly,text:note+input.text})
  if(!continued.ok)throw Error(continued.error||'电脑端服务不可用')
  return {...continued,warning:'这轮画面没看清，已继续文字和语音回复',vision:{status:'unavailable'}}
}
