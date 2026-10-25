import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {speechText} from './public/speech-text.mjs'
const endpoint='https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const model='MiniMax/speech-2.8-hd'
const voices=new Set(['female-shaonv','female-tianmei','female-yujie','female-chengshu'])
export function createAliyunVoice({root,request=fetch,now=Date.now,readConfig}={}){
  const config=readConfig||(()=>{try{return JSON.parse(readFileSync(join(root,'aliyun-voice.json'),'utf8'))}catch{return {}}})
  const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()))
  function ledger(){try{const value=JSON.parse(readFileSync(join(root,'paid-voice-usage.json'),'utf8'));if(value.day===day())return value}catch(e){if(e.code!=='ENOENT')throw Error('语音用量记录损坏，请先检查，未调用付费服务')}return {day:day(),reserved:0,requests:0}}
  function status(){const c=config();let usage;try{usage=ledger()}catch{return {configured:false,error:'用量记录需检查'}}return {configured:!!(c.enabled&&c.key&&voices.has(c.voice)),provider:'阿里云百炼（北京）',model,currency:'CNY',limitCharacters:2000,reservedCharacters:usage.reserved,estimatedMaximumYuan:.7}}
  function reserve(text){
    const c=config()
    if(!c.enabled||!c.key)throw Error('请先在本机配置 .mobile-gateway/aliyun-voice.json')
    if(!voices.has(c.voice))throw Error('当前只允许预置音色，未调用声音复刻')
    const units=Buffer.byteLength(text,'utf8'),usage=ledger()
    if(usage.reserved+units>2000)throw Error('今日人民币语音已到本机试用上限，可切回免费声音')
    mkdirSync(root,{recursive:true});usage.reserved+=units;usage.requests++;writeFileSync(join(root,'paid-voice-usage.json.tmp'),JSON.stringify(usage));renameSync(join(root,'paid-voice-usage.json.tmp'),join(root,'paid-voice-usage.json'))
    return c
  }
  async function* stream(text,signal){
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw Error('语音内容需在2000字以内')
    const spoken=speechText(text),c=reserve(spoken)
    let response
    try{response=await request(endpoint,{method:'POST',headers:{authorization:'Bearer '+c.key,'content-type':'application/json','X-DashScope-SSE':'enable'},body:JSON.stringify({model,input:{text:spoken,stream_options:{exclude_aggregated_audio:true},voice_setting:{voice_id:c.voice,speed:1,vol:1,pitch:1},audio_setting:{sample_rate:24000,bitrate:64000,format:'mp3',channel:1,force_cbr:true},language_boost:'Chinese',subtitle_enable:false}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)})}catch{throw Error('人民币语音连接失败，未自动重试')}
    if(!response.ok)throw Error([401,403].includes(response.status)?'百炼密钥或模型权限未开通':'百炼语音请求失败，请检查余额或控制台限额')
    let pending='',bytes=0,received=false
    const decoder=new TextDecoder()
    const decodeEvent=line=>{
      if(!line.startsWith('data:'))return null
      const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return null
      let event;try{event=JSON.parse(raw)}catch{throw Error('百炼语音返回格式异常')}
      const output=event.output||{},error=output.base_resp?.status_code
      if(event.code||(error!==undefined&&error!==0))throw Error('百炼语音未成功生成，请检查模型权限或余额')
      const data=output.data||{},hex=data.audio
      // Discard final aggregated audio if a provider ignores exclude_aggregated_audio.
      if(data.status===2&&received)return null
      if(!hex)return null
      if(typeof hex!=='string'||hex.length%2||!/^([0-9a-f]{2})+$/i.test(hex))throw Error('百炼语音音频格式异常')
      const chunk=Buffer.from(hex,'hex');bytes+=chunk.length;if(bytes>4_000_000)throw Error('语音音频过长')
      received=true;return chunk
    }
    try{
      for await(const part of response.body){
        pending+=decoder.decode(part,{stream:true});if(pending.length>9_000_000)throw Error('语音响应过长')
        let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end).trim();pending=pending.slice(end+1);const chunk=decodeEvent(line);if(chunk)yield chunk}
      }
      pending+=decoder.decode();if(pending.trim()){const chunk=decodeEvent(pending.trim());if(chunk)yield chunk}
      if(!received)throw Error('百炼语音没有返回音频')
    }catch(e){if(signal?.aborted)throw Error('语音播放已取消');throw Error(e.message?.startsWith('百炼')?e.message:'人民币语音生成中断，未自动重复扣费请求')}
  }
  async function synthesize(text){const chunks=[];for await(const chunk of stream(text))chunks.push(chunk);return {audio:Buffer.concat(chunks).toString('base64'),mime:'audio/mpeg',voice:'百炼 MiniMax · 少女音色'}}
  return {status,stream,synthesize}
}
