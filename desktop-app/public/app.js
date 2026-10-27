import { createAvatar } from './avatar.mjs'
import { createPlaybackGate,formatReply } from './speech-text.mjs'
import { createHandTracker } from './hand-tracker.mjs'
import { createFaceTracker } from './face-tracker.mjs'
import { paidVoiceScript } from './paid-voice-script.mjs'
import { captureFrame } from './camera-frame.mjs'
import { canStreamAudio,streamAudio } from './stream-audio.mjs'
import { parseVoiceScript,isOnlyVocalSound } from './voice-emotion.mjs'
import {createInitiative} from './initiative.mjs'
import {faceResponse,replyExpression,createReactionGate} from './interaction-rules.mjs'
import {createBargeInDetector,createSignalProbe} from './barge-in.mjs'
import {createSentenceFeed} from './sentence-feed.mjs'
import {createReplyPlayer} from './reply-player.mjs'
import {createFingerGaze} from './finger-gaze.mjs'
import {createVideoObserver,prepareTurnVision} from './video-observer.mjs'
import {recoverPending,waitForPending,forgetPending} from './pending-turn.mjs'
const $=id=>document.getElementById(id)
let csrf='',connected=false,busy=false,calling=false,muted=false,speaking=false,epoch=0
let stream=null,context=null,analyser=null,recorder=null,voiceTimer=null,camera=null,cameraEpoch=0
let capture=null
let audioPending=false,cameraPending=false
let speechEpoch=0,speechUrl=null
let voicePreparing=false
let currentSpeechAbort=null
let handTracker=null
let faceTracker=null,faceObservation=null
let initiativeTimer=null,initiativeSpeech=false
let responseController=null
let micProbe=null,echoCancellation=false,lastUserText='',lastUserAt=0,reactionVariant=0,cameraStarted=0
const bargeDetector=createBargeInDetector(),reactionGate=createReactionGate()
let lastInitiative=-Infinity
try{lastInitiative=Number(sessionStorage.getItem('whale-initiative-at'))||-Infinity;$('proactive-camera').checked=localStorage.getItem('whale-proactive-camera')!=='off';$('barge-in').checked=localStorage.getItem('whale-barge-in')!=='off';$('face-follow').checked=localStorage.getItem('whale-face-follow')!=='off';$('face-reply').checked=localStorage.getItem('whale-face-reply')!=='off'}catch{}
const initiative=createInitiative({lastAt:lastInitiative,save:at=>{try{sessionStorage.setItem('whale-initiative-at',String(at))}catch{}}})
const player=document.getElementById('voice-player')
const character=createAvatar({canvas:$('character'),player})
const fingerGaze=createFingerGaze()
const playbackGate=createPlaybackGate()
const videoObserver=createVideoObserver({capture:()=>{if(!camera||document.hidden||!$('auto-frame').checked)throw Error('未分享画面');return frame()},observe:(image,signal)=>api('/api/vision-observe',{image},{signal}),clear:()=>csrf?api('/api/vision-clear',{}):Promise.resolve(),onState:text=>{if(camera&&$('auto-frame').checked)visionStatus(text)}})
const uiStarted=performance.now()
function updateHud(){
  character.setInteraction?.({busy:busy||audioPending||voicePreparing||speaking||Boolean(capture?.speechSeen)})
  character.setGazeEnabled?.(fingerGaze.active())
  if(!$('hud-link'))return
  document.body.dataset.camera=camera?'on':'off'
  document.body.dataset.mode=voicePreparing?'preparing':speaking&&!player.paused?'speaking':busy?'thinking':calling?'listening':'idle'
  $('hud-link').textContent=connected?'已连接':'等待连接'
  $('hud-voice').textContent=voicePreparing?'声音合成中':speaking&&!player.paused?'正在说话':audioPending?'正在听你说话':calling?(muted?'已闭麦':'聆听中'):'待机'
  $('hud-camera').textContent=camera?($('auto-frame').checked?'画面共享':'本地互动'):cameraPending?'等待授权':'未开启'
  const hand=$('hand-status').textContent
  $('hud-hand').textContent=!camera?'未开启':!$('hand-follow').checked?'已关闭':/失败|不支持|不可用|超时/.test(hand)?'暂不可用':hand.includes('正在准备')?'初始化中':/看到你的手|已识别手势/.test(hand)?'已捕获':'等待手部'
}
function updateClocks(){
  if(!$('wall-clock'))return
  $('wall-clock').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())
  const total=Math.floor((performance.now()-uiStarted)/1000)
  $('session-clock').textContent=[Math.floor(total/3600),Math.floor(total/60)%60,total%60].map(n=>String(n).padStart(2,'0')).join(':')
  updateHud()
}
updateClocks();setInterval(updateClocks,1000)
function visionStatus(message){
  $('vision-status').textContent=!camera?'摄像头未开启 · 她还看不到你':!$('auto-frame').checked?'本地视觉互动 · 对话与开场不分享画面':message||'视频互动已开启 · 对话与主动开场按需分享一帧'
  updateHud()
}
const notice=text=>{$('notice').textContent=text;$('notice').hidden=!text}
function controls(){
  $('send').disabled=!connected||busy||audioPending
  for(const id of ['test-voice','test-laugh','test-cry','test-sigh'])$(id).disabled=!connected||busy||audioPending||speaking
  $('share').disabled=busy||audioPending
  $('call').hidden=calling;$('call').disabled=!connected||busy||audioPending||speaking
  $('hangup').hidden=!calling;$('interrupt').hidden=!calling;$('mute').hidden=!calling
  $('mute').textContent=muted?'开麦':'闭麦'
  $('avatar').classList.toggle('speaking',speaking)
  $('state').textContent=speaking?(voicePreparing?'正在准备声音…':'她正在说话'):busy?'鲸鲸在认真想…':audioPending?'鲸鲸在听这段录音…':calling?(muted?'麦克风已关闭':'在听你说话'):'在等你说话'
  updateHud()
}
async function api(path,data,{signal}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100000)
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
  try{
    const res=await fetch(path,{method:data?'POST':'GET',headers:{'content-type':'application/json','x-whale-csrf':csrf},credentials:'same-origin',...(data?{body:JSON.stringify(data)}:{}),signal:controller.signal})
    const value=await res.json()
    if(!res.ok)throw Object.assign(Error(value.error||'暂时连不上鲸鲸，请稍后再试'),{status:res.status})
    return value
  }catch(e){if(signal?.aborted)throw new DOMException('已停止发声','AbortError');if(e.name==='AbortError')throw Error('等得有点久，先点刷新查看；消息不会自动重发');throw e}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
async function history(){
  const result=await api('/api/history')
  $('messages').replaceChildren()
  for(const message of result.messages){
    const line=document.createElement('div');line.className='line'+(message.role==='user'?' mine':'')
    const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=message.text
    const label=document.createElement('div');label.className='message-label';label.textContent=message.role==='user'?'你 / YOU':'鲸鱼娘 / WHALE'
    if(Number.isFinite(message.at)){
      const stamp=document.createElement('time');stamp.dateTime=new Date(message.at).toISOString();stamp.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(message.at));label.append(stamp)
    }
    line.append(label,bubble);$('messages').append(line)
  }
  if(!result.messages.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='先说一声“在吗”吧～';$('messages').append(empty)}
  $('messages').scrollTop=$('messages').scrollHeight
}
function unlockPlayback(){
  void character.unlockAudio()
  // Prime this same audio element during the user's click, before async work.
  if(speaking)return
  const wav=new ArrayBuffer(46),view=new DataView(wav)
  const ascii=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))}
  ascii(0,'RIFF');view.setUint32(4,38,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,2,true)
  const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));player.src=url
  void player.play().catch(()=>{}).finally(()=>URL.revokeObjectURL(url))
}
const CLIP_WAIT_MS=4000
// Plays one emotion clip (a laugh, a sob…) through the shared player before her reply.
// Every failure is a silent skip so the reply itself is never blocked.
async function playEmotionClip(name,style,controller){
  let url=null,finishClip=null,completed=false
  try{
    if(!['cute','gentle'].includes(style))return false
    const response=await fetch(`/api/voice-clip?style=${encodeURIComponent(style)}&name=${encodeURIComponent(name)}&v=natural1`,{credentials:'same-origin',signal:controller.signal})
    if(!response.ok||controller.signal.aborted)return false
    const blob=await response.blob()
    if(!blob.size||controller.signal.aborted)return false
    url=URL.createObjectURL(blob);speechUrl=url;player.src=url;player.hidden=false
    await new Promise(resolve=>{
      let settled=false,timer=null
      finishClip=event=>{
        if(settled)return
        completed=event?.type==='ended'
        settled=true;clearTimeout(timer)
        player.removeEventListener('ended',finishClip);player.removeEventListener('error',finishClip)
        controller.signal.removeEventListener('abort',finishClip)
        if(currentSpeechDone===finishClip)currentSpeechDone=null
        resolve()
      }
      currentSpeechDone=finishClip
      timer=setTimeout(finishClip,CLIP_WAIT_MS)
      player.addEventListener('ended',finishClip);player.addEventListener('error',finishClip)
      controller.signal.addEventListener('abort',finishClip)
      void player.play().catch(()=>finishClip())
    })
    return completed
  }catch{return false}
  finally{
    if(url){
      if(currentSpeechDone===finishClip)currentSpeechDone=null
      if(speechUrl===url)speechUrl=null
      player.pause();player.removeAttribute('src');player.load()
      URL.revokeObjectURL(url)
    }
  }
}
async function speak(text,lease,preview=false,presentation={}){
  if(presentation.responseSignal?.aborted)return
  if(!preview&&(!calling||lease!==epoch))return
  const script=parseVoiceScript(String(text))
  const paid=$('voice-style').value==='aliyun'
  const spoken=paid?paidVoiceScript(String(text),script):script.spoken||String(text)
  interrupt({preserveReply:true})
  const generation=++speechEpoch
  player.dataset.speechStart=String(performance.now());player.dataset.firstPlayMs='';player.dataset.generatedMs=''
  speaking=true;voicePreparing=true;controls()
  character.express(presentation.expression||replyExpression(String(text)),{source:presentation.expression?'face':'reply'})
  if(recorder?.state==='recording'&&!capture?.monitor){if(capture)capture.discard=true;recorder.stop()}
  bargeDetector.reset();resumeRecorder()
  const controller=new AbortController();currentSpeechAbort=controller
  const parentAbort=()=>{controller.abort();if(currentSpeechAbort===controller){player.pause();currentSpeechDone?.()}};presentation.responseSignal?.addEventListener('abort',parentAbort,{once:true})
  if(script.clip&&!paid){
    character.express?.(script.clip.startsWith('cry')?'cry':script.clip.startsWith('sigh')?'sigh':'smile',{source:presentation.expression?'face':'voice'})
    // Recorded vocal effect first, followed by any meaningful spoken words.
    const played=await playEmotionClip(script.clip,$('voice-style').value,controller)
    if(generation!==speechEpoch){presentation.responseSignal?.removeEventListener('abort',parentAbort);return}
    if(played&&isOnlyVocalSound(String(text),script.clip)){
      currentSpeechAbort=null;speaking=false;voicePreparing=false;player.hidden=true;controls()
      resumeRecorder()
      presentation.responseSignal?.removeEventListener('abort',parentAbort)
      return
    }
  }
  let finish
  const playbackDone=new Promise(resolve=>{
    let settled=false
    finish=()=>{if(settled)return;settled=true;clearTimeout(timer);player.onended=null;player.onerror=null;resolve()}
    const timer=setTimeout(()=>{controller.abort();player.pause();notice('播放已停止，可以点试听再试');finish()},120000)
    currentSpeechDone=finish;player.onended=finish;player.onerror=()=>{notice('音频播放失败，请检查电脑的输出设备');controller.abort();finish()}
  })
  const startPlayback=()=>{
    if(generation!==speechEpoch)return
    voicePreparing=false;controls()
    void player.play().catch(e=>{
      if(generation!==speechEpoch){finish();return}
      if(e.name==='NotAllowedError'){notice('浏览器暂停了自动播放，请点“播放声音”');$('resume-audio').hidden=false}
      else{notice('声音没播放成功，请点试听再试，并检查电脑音量');controller.abort();finish()}
    })
  }
  try{
    notice('')
    player.dataset.streaming=String(canStreamAudio())
    if(canStreamAudio()){
      await streamAudio({player,text:spoken,style:$('voice-style').value,csrf,signal:controller.signal,onUrl:url=>{speechUrl=url},onPlayable:startPlayback,responsePromise:presentation.responsePromise})
    }else{
      const result=await api('/api/speech',{text:spoken,style:$('voice-style').value},{signal:controller.signal})
      if(generation!==speechEpoch||(!preview&&(!calling||lease!==epoch)))return
      const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0))
      speechUrl=URL.createObjectURL(new Blob([bytes],{type:result.mime}));player.src=speechUrl;player.hidden=false;startPlayback()
    }
    player.dataset.generatedMs=String(Math.round(performance.now()-Number(player.dataset.speechStart)))
    await playbackDone
  }catch(e){if(generation===speechEpoch&&e.name!=='AbortError')notice(e.message)}
  finally{
    finish()
    presentation.responseSignal?.removeEventListener('abort',parentAbort)
    if(generation===speechEpoch){currentSpeechAbort=null;currentSpeechDone=null;speaking=false;voicePreparing=false;controls();resumeRecorder()}
  }
}
let currentSpeechDone=null
function interrupt({preserveReply=false}={}){if(!preserveReply){responseController?.abort();responseController=null;character.resetAction?.()}speechEpoch++;currentSpeechAbort?.abort();currentSpeechAbort=null;player.pause();currentSpeechDone?.();currentSpeechDone=null;player.removeAttribute('src');player.load();if(speechUrl)URL.revokeObjectURL(speechUrl);speechUrl=null;player.hidden=true;$('resume-audio').hidden=true;speaking=false;voicePreparing=false;controls()}
// Replaying a finished clip must also keep the microphone from hearing her.
player.addEventListener('playing',()=>{
  if(!speechUrl||player.hidden)return
  if(!player.dataset.firstPlayMs)player.dataset.firstPlayMs=String(Math.round(performance.now()-Number(player.dataset.speechStart)))
  if(responseController&&!player.dataset.turnFirstPlayMs)player.dataset.turnFirstPlayMs=String(Math.round(performance.now()-Number(player.dataset.turnStarted)))
  $('resume-audio').hidden=true
  speaking=true;voicePreparing=false
  if(recorder?.state==='recording'&&!capture?.monitor){if(capture)capture.discard=true;recorder.stop()}
  resumeRecorder()
  controls()
})
function replayStopped(){
  if(!speechUrl||currentSpeechDone)return
  speaking=false;controls();resumeRecorder()
}
player.addEventListener('pause',replayStopped);player.addEventListener('ended',replayStopped)
// "听笑声/听哭声": audition one generated clip without touching the conversation.
async function audition(name,button){
  if(button.disabled||busy||speaking||audioPending)return
  character.express?.(name.startsWith('cry')?'cry':name.startsWith('sigh')?'sigh':'smile')
  if($('voice-style').value==='aliyun'){
    unlockPlayback();await speak(({laugh_1:'(chuckle)',cry_1:'(crying)',sigh_1:'(sighs)'})[name]||'(chuckle)',epoch,true);return
  }
  unlockPlayback()
  interrupt()
  character.express?.(name.startsWith('cry')?'cry':name.startsWith('sigh')?'sigh':'smile',{source:'voice'})
  const generation=speechEpoch,controller=new AbortController()
  currentSpeechAbort=controller;speaking=true;voicePreparing=false;controls()
  if(recorder?.state==='recording'){if(capture)capture.discard=true;recorder.stop()}
  player.dataset.speechStart=String(performance.now());player.dataset.firstPlayMs='';player.dataset.generatedMs=''
  button.disabled=true
  try{
    const played=await playEmotionClip(name,$('voice-style').value,controller)
    if(!played&&generation===speechEpoch)notice('这段声音还没准备好，可以先点“试听”听普通语音')
  }finally{
    if(generation===speechEpoch){
      currentSpeechAbort=null;speaking=false;voicePreparing=false;player.hidden=true;controls()
      resumeRecorder()
    }
    button.disabled=false
  }
}
async function send(text,image,{initiative:initiativeKind=null,cameraLease=null}={}){
  if(busy||!connected||!text.trim())return
  busy=true;notice('');$('heard').textContent='';controls()
  if(!initiativeKind)initiative.userTurn()
  if(!initiativeKind){
    const gazeCommand=fingerGaze.command(text)
    if(gazeCommand){
      character.setGazeEnabled?.(fingerGaze.active())
      $('hand-status').textContent=gazeCommand==='start'?'已收到指尖注视指令 · 30秒后恢复正视，说“看回我”可提前结束':'已结束指尖注视 · 恢复正视'
      if(gazeCommand==='start'&&!camera)notice('请先打开互动摄像头，再把食指放进画面。')
    }
  }
  if(!initiativeKind){lastUserText=text.trim();lastUserAt=Date.now();reactionGate.mark()}
  let useVision=false
  if(image)visionStatus('正在准备本轮最新画面…')
  if(recorder?.state==='recording'){capture.discard=true;recorder.stop()}
  const lease=epoch,id=crypto.randomUUID()
  const controller=new AbortController();responseController=controller
  player.dataset.turnStarted=String(performance.now());player.dataset.turnFirstPlayMs='';resumeRecorder()
  const canPlay=()=>responseController===controller&&!controller.signal.aborted&&lease===epoch&&(initiativeKind?camera&&cameraLease===cameraEpoch&&$('proactive-camera').checked&&!document.hidden:calling)
  const queue=createReplyPlayer({signal:controller.signal,canPlay,prepare:segment=>{
    if(!canStreamAudio())return undefined
    const script=parseVoiceScript(segment),paid=$('voice-style').value==='aliyun'
    if(!paid&&isOnlyVocalSound(segment,script.clip))return undefined
    const spoken=paid?paidVoiceScript(segment,script):script.spoken||segment
    return fetch('/api/speech-stream',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-whale-csrf':csrf},body:JSON.stringify({text:spoken,style:$('voice-style').value}),signal:controller.signal})
  },play:async(segment,responsePromise)=>{initiativeSpeech=!!initiativeKind;try{await speak(segment,lease,!!initiativeKind,{responsePromise,responseSignal:controller.signal})}finally{initiativeSpeech=false}}})
  try{
    await waitForPending({storage:sessionStorage,getJob:previous=>api('/api/jobs/'+previous,undefined,{signal:controller.signal}),signal:controller.signal})
    controller.signal.throwIfAborted()
    // Recapture after any recovery wait. A closed camera revokes the old frame too.
    const turnVision=prepareTurnVision({image,sharing:camera&&$('auto-frame').checked,capture:frame,initiative:!!initiativeKind,fresh:videoObserver.fresh(),text})
    image=turnVision.image;useVision=turnVision.useVision
    if(image)visionStatus(useVision?'主动闲聊参考近期画面':'正在分析刚抓取的本轮照片…')
    const faceCue=image&&faceObservation?.code&&performance.now()-faceObservation.at<1500?faceObservation.code:undefined
    const feed=createSentenceFeed({earlyFirstClause:true});const audioAllowed=canPlay()&&playbackGate.claim(id)
    const bubble=document.createElement('div'),line=document.createElement('div');line.className='line';bubble.className='bubble';line.append(bubble);$('messages').append(line)
    const job=await readLiveReply({id,text:text.trim(),...(image&&!useVision?{image}:{}),...(useVision?{useVision:true}:{}),...(faceCue?{faceCue}:{}),...(initiativeKind?{initiative:initiativeKind}:{})},controller.signal,event=>{
      if(event.type==='accepted'){sessionStorage.setItem('whale-pending',id);return}
      bubble.textContent=formatReply(event.text)
      if(audioAllowed)for(const segment of feed.update(event.text,event.type==='done'))queue.push(segment)
    })
    if(image){
      if(job.vision?.status==='unavailable')visionStatus('这轮画面没看清 · 连续视觉仍在重试')
      else visionStatus(useVision?'主动闲聊已参考近期画面':'本轮照片已分析 · 新动作请再问一句')
    }
    sessionStorage.removeItem('whale-pending')
    await Promise.all([history().catch(e=>notice(e.message)),queue.finish()])
    if(job.warning)notice('画面暂没看清，仍会继续分析和陪你说话')
  }catch(e){queue.cancel();if(e.status===404)forgetPending(sessionStorage,id);if(!controller.signal.aborted)notice(e.message);controller.abort()}finally{if(responseController===controller)responseController=null;busy=false;initiative.activity();controls();resumeRecorder()}
}
async function readLiveReply(input,signal,onText){
  const response=await fetch('/api/live-chat',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-whale-csrf':csrf},body:JSON.stringify(input),signal})
  if(!response.ok){const value=await response.json();throw Object.assign(Error(value.error||'对话连接暂不可用'),{status:response.status})}
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',result=null
  try{while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});if(pending.length>64000)throw Error('回答过长');let end
    while((end=pending.indexOf('\n'))>=0){const raw=pending.slice(0,end);pending=pending.slice(end+1);if(!raw.trim())continue;const event=JSON.parse(raw);if(event.type==='error')throw Object.assign(Error(event.error),{status:event.status});if(['accepted','text','done'].includes(event.type))onText(event);if(event.type==='done')result=event}
  }if(!result)throw Error('回答连接中断，可查看通信记录');return result}finally{reader.releaseLock()}
}
async function refresh(){
  try{
    const job=await recoverPending({storage:sessionStorage,getJob:id=>api('/api/jobs/'+id)})
    if(job){if(job.status==='done')notice('已经找回上一条回复');else if(job.status==='missing')notice('已清理失效的等待记录，可以继续说话');else if(job.status!=='pending')notice(job.error||'上一条未完成');else notice('她还在回复，稍后再刷新')}
    await history()
  }catch(e){notice(e.message)}
}
function canBargeIn(){return calling&&!muted&&echoCancellation&&$('barge-in').checked}
function resumeRecorder(){
  if(!calling||muted)return
  if(capture?.monitor&&!speaking&&!busy&&recorder?.state==='recording'){capture.discard=true;recorder.stop();return}
  startRecorder({monitor:(speaking||busy)&&canBargeIn()})
}
function startRecorder({monitor=false}={}){
  if(!calling||muted||audioPending||!stream||recorder?.state==='recording')return
  if(monitor?!canBargeIn():busy||speaking)return
  const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type))
  const recording={chunks:[],speechSeen:false,lastLoud:0,loudSince:0,discard:monitor,monitor,trimStartMs:0,started:Date.now()}
  capture=recording
  recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined)
  const localRecorder=recorder,lease=epoch
  localRecorder.ondataavailable=event=>{if(event.data.size)recording.chunks.push(event.data)}
  localRecorder.onstop=async()=>{
    const chunks=recording.chunks,skip=recording.discard||!recording.speechSeen||!calling||muted||lease!==epoch
    if(recorder===localRecorder)recorder=null
    if(capture===recording)capture=null
    if(skip){setTimeout(resumeRecorder,100);return}
    audioPending=true;controls()
    try{
      const blob=new Blob(chunks,{type:localRecorder.mimeType}),audio=await base64(blob)
      if(!calling||muted||lease!==epoch)return
      const result=await api('/api/transcribe',{audio,...(recording.trimStartMs?{trimStartMs:recording.trimStartMs}:{})})
      if(!calling||lease!==epoch)return
      if(!result.text?.trim()){notice('刚才有点轻，再和鲸鲸说一遍吧');return}
      $('heard').textContent='听到：'+result.text
      let image
      if(camera&&$('auto-frame').checked){image=frame()}
      audioPending=false;controls()
      await send(result.text,image)
    }catch(e){notice(e.message)}finally{audioPending=false;controls();resumeRecorder()}
  }
  localRecorder.onerror=()=>{notice('录音暂时不可用，请检查麦克风后重新开始');hangup()}
  localRecorder.start(100)
}
function base64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob)})}
function meter(){
  if(!calling||!micProbe||muted||audioPending||recorder?.state!=='recording')return
  const mic=micProbe(),rms=mic.rms,now=Date.now()
  const rec=capture;if(!rec)return
  if(rec.monitor){
    const event=bargeDetector.update({mic,output:character.voiceSample()||{playing:!player.paused&&!player.ended},active:speaking||busy,enabled:canBargeIn(),now})
    if(event){
      rec.monitor=false;rec.discard=false;rec.speechSeen=true;rec.lastLoud=now;rec.loudSince=event.startedAt
      rec.trimStartMs=Math.max(0,event.startedAt-rec.started-event.trimLeadMs)
      interrupt();character.express('attentive',{source:'interrupt'});initiative.activity();reactionGate.mark()
      player.dataset.bargeLatencyMs=String(event.detectedAt-event.startedAt)
      notice('你说，鲸鲸在听。')
    }else if((!speaking&&!busy)||!canBargeIn()||now-rec.started>27000){rec.discard=true;recorder.stop()}
    return
  }
  if(busy&&!rec.speechSeen)return
  bargeDetector.update({mic,active:false,enabled:false,now})
  if(rms>.017){if(!rec.loudSince)rec.loudSince=now;if(now-rec.loudSince>=120){if(!rec.speechSeen)character.setInteraction?.({busy:true});rec.speechSeen=true;rec.lastLoud=now}}
  else rec.loudSince=0
  if(rec.speechSeen&&rec.lastLoud&&now-rec.lastLoud>450){recorder.stop()}
  else if(now-rec.started>28000){rec.discard=!rec.speechSeen;recorder.stop()}
  else if(!rec.speechSeen&&now-rec.started>10000){rec.discard=true;recorder.stop()}
}
async function call(){
  if(!connected||busy||audioPending)return
  unlockPlayback()
  const lease=++epoch
  try{
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('当前浏览器不支持录音，请用 Microsoft Edge 打开电脑版')
    const next=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
    if(lease!==epoch||document.hidden){next.getTracks().forEach(t=>t.stop());return}
    stream=next;context=new AudioContext();await context.resume()
    analyser=context.createAnalyser();analyser.fftSize=1024;context.createMediaStreamSource(stream).connect(analyser)
    micProbe=createSignalProbe(analyser,context.sampleRate);echoCancellation=stream.getAudioTracks()[0]?.getSettings?.().echoCancellation===true
    $('barge-status').textContent=echoCancellation?'回声消除已开启 · 支持开口打断（试用）':'设备未确认回声消除 · 请用打断按钮'
    calling=true;muted=false;notice('');controls();startRecorder();voiceTimer=setInterval(meter,60)
    if(!camera)await toggleCamera()
  }catch(e){hangup();notice(e.name==='NotAllowedError'?'麦克风还没允许，可以先打字；允许后再点开始':e.message)}
}
function hangup({keepCamera=false}={}){
  calling=false;epoch++;clearInterval(voiceTimer);voiceTimer=null;if(capture)capture.discard=true
  if(recorder?.state==='recording')recorder.stop()
  stream?.getTracks().forEach(t=>t.stop());stream=null
  micProbe=null;echoCancellation=false;bargeDetector.reset();$('barge-status').textContent='开始语音陪聊后检测回声消除'
  void context?.close();context=null;analyser=null
  interrupt();fingerGaze.reset();character.setGazeEnabled?.(false);if(!keepCamera)stopCamera();else character.setGaze(null);$('heard').textContent='';controls()
}
function mute(){
  muted=!muted;if(capture)capture.discard=true;if(recorder?.state==='recording')recorder.stop()
  stream?.getAudioTracks().forEach(t=>t.enabled=!muted)
  if(!muted)resumeRecorder();controls()
}
async function toggleCamera(){
  if(camera){stopCamera();return}
  if(cameraPending)return
  cameraPending=true;const lease=++cameraEpoch
  unlockPlayback()
  try{
    const next=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false})
    if(lease!==cameraEpoch||document.hidden){next.getTracks().forEach(t=>t.stop());return}
    camera=next;cameraStarted=Date.now();$('preview').srcObject=camera;$('camera-panel').hidden=false;$('camera').textContent='关闭互动摄像头'
    $('auto-frame').checked=true;visionStatus()
    for(const track of camera.getVideoTracks())track.addEventListener('ended',()=>{if(camera===next){stopCamera();notice('摄像头连接已断开，请重新打开')}})
    if($('hand-follow').checked)startHandTracking()
    if($('face-follow').checked)startFaceTracking()
    videoObserver.start()
    initiative.open();clearInterval(initiativeTimer);initiativeTimer=setInterval(()=>void initiativeTick(),500)
  }catch(e){notice(e.name==='NotAllowedError'?'摄像头还没允许，不影响文字和语音聊天':'摄像头暂时不可用，请检查设备')}
  finally{cameraPending=false}
}
function stopCamera(){cameraEpoch++;videoObserver.stop();clearInterval(initiativeTimer);initiativeTimer=null;initiative.close();if(initiativeSpeech)interrupt();handTracker?.stop();handTracker=null;faceTracker?.stop();faceTracker=null;faceObservation=null;fingerGaze.reset();character.setGazeEnabled?.(false);character.setGaze(null);character.resetAction?.();camera?.getTracks().forEach(t=>t.stop());camera=null;$('preview').srcObject=null;$('camera-panel').hidden=true;$('camera').textContent='打开互动摄像头';$('auto-frame').checked=false;visionStatus()}
async function initiativeTick(){
  if(!camera)return
  const video=$('preview')
  const kind=initiative.next({ready:video.readyState>=2&&video.videoWidth>0,enabled:$('proactive-camera').checked,available:connected&&!document.hidden&&!busy&&!speaking&&!audioPending&&!capture?.speechSeen&&!$('input').value.trim()&&document.activeElement!==$('input')&&!sessionStorage.getItem('whale-pending')&&reactionGate.ready()})
  if(!kind)return
  reactionGate.mark()
  let image
  try{if($('auto-frame').checked)image=frame()}catch{/* An unreadable frame must not block a friendly opener. */}
  await send('主动陪聊',image,{initiative:kind,cameraLease:cameraEpoch})
}
function startFaceTracking(){
  faceTracker?.stop();faceTracker=null;faceObservation=null
  if(!camera||!$('face-follow').checked)return
  faceTracker=createFaceTracker({video:$('preview'),onState:state=>{faceObservation=state.code?state:null;if($('face-status').textContent!==state.label)$('face-status').textContent=state.label},onReaction:state=>{
    if(!camera||document.hidden||!$('face-reply').checked)return
    if(busy||speaking||audioPending||capture?.speechSeen||$('input').value.trim()||document.activeElement===$('input')||Date.now()-cameraStarted<8000)return
    const response=faceResponse(state.code,{userText:Date.now()-lastUserAt<60000?lastUserText:'',variant:reactionVariant++})
    if(!response||!reactionGate.claim())return
    character.express(response.expression,{source:'face'})
    void speak(response.text,epoch,true,{expression:response.expression})
  }})
  faceTracker.start()
}
function startHandTracking(){
  handTracker?.stop();handTracker=null
  if(!camera||!$('hand-follow').checked)return
  handTracker=createHandTracker({video:$('preview'),overlay:$('hand-overlay'),isGazeEnabled:()=>fingerGaze.active(),onGaze:target=>character.setGaze(target),onStatus:text=>{if($('hand-status').textContent!==text)$('hand-status').textContent=text},onWave:()=>{
    if(!camera||document.hidden)return
    if(busy||speaking||audioPending){$('hand-status').textContent='看到你挥手啦～等鲸鲸说完';return}
    if(capture?.speechSeen||$('input').value.trim()||document.activeElement===$('input')||!reactionGate.claim())return
    $('hand-status').textContent='收到你的挥手啦，鲸鲸用声音向你问好～'
    void speak('你好呀，鲸鲸也向你打招呼～',epoch,true)
  }})
  handTracker.start()
}
function frame(){
  const video=$('preview');if(!camera||!video.videoWidth)throw Error('摄像头还在准备，请稍等一下')
  return captureFrame(video).image
}
$('composer').addEventListener('submit',event=>{event.preventDefault();const text=$('input').value;if(!text.trim()||busy||audioPending)return;try{const image=camera&&$('auto-frame').checked?frame():undefined;$('input').value='';void send(text,image)}catch(e){notice(e.message)}})
$('input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit()}})
$('input').addEventListener('input',()=>initiative.activity())
$('barge-in').addEventListener('change',()=>{bargeDetector.reset();resumeRecorder();try{localStorage.setItem('whale-barge-in',$('barge-in').checked?'on':'off')}catch{}})
$('proactive-camera').addEventListener('change',()=>{try{localStorage.setItem('whale-proactive-camera',$('proactive-camera').checked?'on':'off')}catch{};if(!$('proactive-camera').checked&&initiativeSpeech)interrupt();initiative.activity()})
$('call').addEventListener('click',()=>void call());$('hangup').addEventListener('click',hangup);$('interrupt').addEventListener('click',interrupt)
$('test-voice').addEventListener('click',()=>{unlockPlayback();void speak('你好呀，鲸鲸在这里陪你。慢慢说，我在听呢。',epoch,true)})
$('test-laugh').addEventListener('click',event=>void audition('laugh_1',event.currentTarget))
$('test-cry').addEventListener('click',event=>void audition('cry_1',event.currentTarget))
$('mute').addEventListener('click',mute);$('camera').addEventListener('click',()=>void toggleCamera());$('refresh').addEventListener('click',()=>void refresh())
$('hand-follow').addEventListener('change',()=>{if($('hand-follow').checked)startHandTracking();else{handTracker?.stop();handTracker=null;fingerGaze.reset();character.setGazeEnabled?.(false);character.setGaze(null);$('hand-status').textContent='手势互动已关闭，可以继续分享画面'}})
$('face-follow').addEventListener('change',()=>{try{localStorage.setItem('whale-face-follow',$('face-follow').checked?'on':'off')}catch{};if($('face-follow').checked)startFaceTracking();else{faceTracker?.stop();faceTracker=null;faceObservation=null;$('face-status').textContent='面部动作识别已关闭'}})
$('face-reply').addEventListener('change',()=>{try{localStorage.setItem('whale-face-reply',$('face-reply').checked?'on':'off')}catch{}})
$('test-sigh').addEventListener('click',event=>void audition('sigh_1',event.currentTarget))
async function refreshVoiceServices(){
  try{
    const {paid}=await api('/api/voice-services'),option=$('paid-voice-option')
    option.disabled=!paid.configured;option.textContent=paid.configured?'百炼少女声 · 人民币':'百炼情绪语音 · 待配置'
    $('paid-voice-status').textContent=paid.configured?'人民币语音已配置；本机试用上限估算≤0.7元/天。':'人民币语音未配置。先完成百炼开通，再双击本机 WhaleGirl-Voice-Setup.cmd。'
  }catch{$('paid-voice-status').textContent='暂时无法检查人民币语音配置，可以先用免费声音'}
}
$('check-paid-voice').addEventListener('click',()=>void refreshVoiceServices())
$('auto-frame').addEventListener('change',()=>{if(camera&&$('auto-frame').checked)videoObserver.start();else videoObserver.stop();visionStatus()})
$('resume-audio').addEventListener('click',()=>{void character.unlockAudio();void player.play().then(()=>notice('')).catch(()=>notice('暂时无法播放，请检查电脑音量或重新试听'))})
function showChat(open){$('chat-log').hidden=!open;$('toggle-chat').setAttribute('aria-expanded',String(open));if(open)$('messages').scrollTop=$('messages').scrollHeight}
$('toggle-chat').addEventListener('click',()=>showChat($('chat-log').hidden))
$('close-chat').addEventListener('click',()=>showChat(false))
$('toggle-voice').addEventListener('click',()=>{const open=$('voice-options').hidden;$('voice-options').hidden=!open;$('toggle-voice').setAttribute('aria-expanded',String(open))})
document.addEventListener('keydown',event=>{if(event.key==='Escape')showChat(false)})
$('share').addEventListener('click',()=>{if(busy||audioPending)return;try{void send('看看我现在的画面，陪我聊两句。',frame())}catch(e){notice(e.message)}})
document.addEventListener('visibilitychange',()=>{if(document.hidden){videoObserver.stop();hangup({keepCamera:true})}else if(camera&&$('auto-frame').checked)videoObserver.start()});window.addEventListener('pagehide',()=>hangup())
async function init(){
  controls();visionStatus()
  try{const boot=await api('/api/bootstrap');csrf=boot.csrf;connected=true;$('connection').textContent='已连接 · 记忆沿用';$('connection').classList.add('online');await refresh();void refreshVoiceServices()}
  catch(e){notice(e.message);$('connection').textContent='暂未连接，请刷新页面'}
  controls()
}
void init()
