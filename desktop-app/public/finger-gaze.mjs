export function fingerGazeCommand(input){
  if(typeof input!=='string')return null
  const text=input.trim().slice(0,200)
  const finger=/手指|食指|指尖/.test(text),tracking=/看|盯|注视|跟随|跟着|追踪|追着/.test(text)
  if(/看回来|看回我(?!的?(?:手指|食指|指尖))|看着我(?!的?(?:手指|食指|指尖))|看我的脸|看我脸|回来看我|继续聊天|结束这个动作/.test(text))return 'stop'
  if(/别|不要|不用|停止|结束|取消|不必/.test(text)&&(finger||/跟随|追踪|注视/.test(text)))return 'stop'
  if(text.length>60||/如果|假如|假设|比如|例如|翻译|解释|什么意思|这句话|这几个字|他说|她说|你说|刚才|之前|上次|[“”「」『』"]/.test(text))return null
  const request=/^(?:(?:鲸鱼娘|鲸鲸|请|麻烦你?|你|现在|来|能不能|能否|可不可以|我想让你|我想请你|帮我|试着|可以|能|把|让|眼睛|的|再|先)[，,：:\s]*)*(?:看|盯|注视|跟随|跟着|追踪|追着).{0,14}(?:手指|食指|指尖)/
  if(finger&&tracking&&request.test(text))return 'start'
  return null
}
export function createFingerGaze({now=Date.now,duration=30000}={}){
  let until=0
  const active=()=>until>now()
  return {
    active,
    command(text){const kind=fingerGazeCommand(text);if(kind==='start')until=now()+duration;else if(kind==='stop')until=0;return kind},
    remaining:()=>Math.max(0,until-now()),
    reset(){until=0},
  }
}
