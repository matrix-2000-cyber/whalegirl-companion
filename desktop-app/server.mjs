import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { desktopClient } from './gateway-client.mjs'
import { createTranscriber } from './audio.mjs'
import { createSpeaker } from './tts.mjs'
import {createWarmSpeechService} from './warm-tts.mjs'
import { formatReply } from './public/speech-text.mjs'
import { createAliyunVoice } from './aliyun-voice.mjs'
import {createWarmRecognizer} from './warm-asr.mjs'
import {liveChat} from './live-chat.mjs'
import {gatewayRoot,servicePort} from '../mobile-gateway/runtime.mjs'

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), 'public')
const runtimeRoot=resolve(process.env.WHALEGIRL_RUNTIME_ROOT || resolve(publicRoot,'../../.desktop-runtime'))
const vendorAssets={
  '/vendor/vision/vision_bundle.js':['vision/node_modules/@mediapipe/tasks-vision/vision_bundle.js','text/javascript'],
  '/vendor/models/hand_landmarker.task':['models/hand_landmarker.task','application/octet-stream'],
  '/vendor/models/face_landmarker.task':['models/face_landmarker.task','application/octet-stream'],
}
for(const name of ['vision_wasm_internal','vision_wasm_module_internal','vision_wasm_nosimd_internal']){
  for(const ext of ['js','wasm'])vendorAssets['/vendor/vision/wasm/'+name+'.'+ext]=['vision/node_modules/@mediapipe/tasks-vision/wasm/'+name+'.'+ext,ext==='wasm'?'application/wasm':'text/javascript']
}
const clipRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../bridge-src/assets/voice-clips')
const CLIP_STYLES=new Set(['cute','gentle'])
const CLIP_NAME=/^[a-z][a-z0-9_]{1,30}$/
// Read-only view of the generated emotion clips. A missing or broken manifest only
// disables clips; every other desktop endpoint keeps working.
export function createClipReader({dir=clipRoot,ttl=5*60*1000,now=Date.now,readFile=readFileSync}={}){
  let index=null,loadedAt=0
  const root=resolve(dir)
  function load(){
    if(index&&now()-loadedAt<ttl)return index
    const next=new Map()
    try{
      const manifest=JSON.parse(readFile(join(root,'manifest.json'),'utf8'))
      for(const clip of Array.isArray(manifest?.clips)?manifest.clips:[]){
        const style=String(clip?.style??''),name=String(clip?.name??''),file=String(clip?.file??'')
        if(!CLIP_STYLES.has(style)||!CLIP_NAME.test(name)||!file.endsWith('.mp3')||file.length>200)continue
        if(file.includes('\\')||file.includes('\0'))continue
        const full=resolve(root,file)
        if(!full.startsWith(root+sep))continue
        next.set(`${style}/${name}`,full)
      }
    }catch{/* no clips yet: the page silently falls back to plain speech */}
    index=next;loadedAt=now()
    return index
  }
  return {read(style,name){
    if(!CLIP_STYLES.has(style)||!CLIP_NAME.test(name))return null
    const file=load().get(`${style}/${name}`)
    if(!file)return null
    try{const audio=readFile(file);return audio?.length&&audio.length<=4_000_000?audio:null}catch{return null}
  }}
}
export function desktopApp({ gateway, transcribe, synthesize, streamSpeech,audioStatus=()=>({ready:true}),paidVoiceStatus=()=>({configured:false}),port = 3092, now = Date.now, clips = createClipReader() }) {
  const sessions = new Map()
  const equal = (a,b) => { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||'')); return x.length===y.length && timingSafeEqual(x,y) }
  const json = (res, status, body) => { res.writeHead(status, { 'content-type':'application/json; charset=utf-8','cache-control':'no-store' }); res.end(JSON.stringify(body)) }
  async function body(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw Error('请刷新后再试')
    const chunks=[]; let bytes=0
    for await (const chunk of req) { bytes+=chunk.length; if(bytes>4_500_000) throw Error('内容太长，请分成短句'); chunks.push(chunk) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  return async (req,res) => {
    res.setHeader('x-content-type-options','nosniff')
    res.setHeader('x-frame-options','DENY')
    res.setHeader('referrer-policy','no-referrer')
    res.setHeader('permissions-policy','camera=(self), microphone=(self)')
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    try {
      const host=String(req.headers.host || ''), allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`]
      if(!allowedHosts.includes(host) || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return json(res,403,{error:'仅限这台电脑使用'})
      const origin='http://'+host
      const path=new URL(req.url,origin).pathname
      if(req.headers.origin && req.headers.origin!==origin) return json(res,403,{error:'请从鲸鱼娘页面操作'})
      const navigation=path==='/' && req.method==='GET' && req.headers['sec-fetch-mode']==='navigate' && req.headers['sec-fetch-dest']==='document'
      if(req.headers['sec-fetch-site']==='cross-site' && !navigation) return json(res,403,{error:'请直接打开鲸鱼娘'})
      if(path==='/health' && req.method==='GET') return json(res,200,{ok:true,...(process.env.WHALEGIRL_INSTANCE_ID?{instance:process.env.WHALEGIRL_INSTANCE_ID}:{})})
      const cookie=String(req.headers.cookie||'').match(/(?:^|;\s*)whale_desktop=([a-f0-9]{48})(?:;|$)/)?.[1]
      let session=sessions.get(cookie)
      if(session && session.expires<now()){sessions.delete(cookie);session=null}
      if(path==='/' && req.method==='GET') {
        if(!session){
          const id=randomBytes(24).toString('hex');session={csrf:randomBytes(24).toString('hex'),expires:now()+8*60*60*1000};sessions.set(id,session)
          res.setHeader('set-cookie',`whale_desktop=${id}; Path=/; HttpOnly; SameSite=Strict`)
          if(sessions.size>100) sessions.delete(sessions.keys().next().value)
        }
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(readFileSync(join(publicRoot,'hud.html')));return
      }
      const assets={'/app.js':['app.js','text/javascript; charset=utf-8'],'/avatar.mjs':['avatar.mjs','text/javascript; charset=utf-8'],'/hand-tracker.mjs':['hand-tracker.mjs','text/javascript; charset=utf-8'],'/hand-rules.mjs':['hand-rules.mjs','text/javascript; charset=utf-8'],'/hand-worker.js':['hand-worker.js','text/javascript; charset=utf-8'],'/speech-text.mjs':['speech-text.mjs','text/javascript; charset=utf-8'],'/voice-emotion.mjs':['voice-emotion.mjs','text/javascript; charset=utf-8'],'/whalegirl-atlas.png':['whalegirl-atlas.png','image/png'],'/style.css':['style.css','text/css; charset=utf-8'],'/whale.png':['whale.png','image/png']}
      assets['/standing-policy.mjs']=['standing-policy.mjs','text/javascript; charset=utf-8']
      assets['/mouth-sync.mjs']=['mouth-sync.mjs','text/javascript; charset=utf-8']
      assets['/pending-turn.mjs']=['pending-turn.mjs','text/javascript; charset=utf-8']
      assets['/finger-gaze.mjs']=['finger-gaze.mjs','text/javascript; charset=utf-8']
      assets['/standing/front.png']=['standing/front.png','image/png']
        for(const name of ['blink-open','blink-half','blink-closed',...Array.from({length:7},(_,i)=>'blink-'+i)])assets['/standing/'+name+'.png']=['standing/'+name+'.png','image/png']
      for(const action of ['wave','smile','sigh','shy','bow'])assets['/standing/'+action+'.webm']=['standing/'+action+'.webm','video/webm']
      if(req.method==='GET'&&vendorAssets[path]){const [file,type]=vendorAssets[path];res.writeHead(200,{'content-type':type,'cache-control':'private, max-age=3600'});res.end(readFileSync(join(runtimeRoot,file)));return}
      assets['/hud.css']=['hud.css','text/css; charset=utf-8']
      assets['/study.css']=['study.css','text/css; charset=utf-8']
      assets['/camera-frame.mjs']=['camera-frame.mjs','text/javascript; charset=utf-8']
      assets['/stream-audio.mjs']=['stream-audio.mjs','text/javascript; charset=utf-8']
      for(const name of ['face-rules.mjs','face-tracker.mjs','face-worker.js','interaction-rules.mjs','barge-in.mjs','avatar-motion.mjs'])assets['/'+name]=[name,'text/javascript; charset=utf-8']
      assets['/paid-voice-script.mjs']=['paid-voice-script.mjs','text/javascript; charset=utf-8']
      assets['/initiative.mjs']=['initiative.mjs','text/javascript; charset=utf-8']
      for(const name of ['sentence-feed.mjs','video-observer.mjs','reply-player.mjs'])assets['/'+name]=[name,'text/javascript; charset=utf-8']
      assets['/study-room.png']=['study-room.png','image/png']
      assets['/whalegirl-seated-atlas.png']=['whalegirl-seated-atlas.png','image/png']
      if(req.method==='GET' && assets[path]) {const [file,type]=assets[path];res.writeHead(200,{'content-type':type});res.end(readFileSync(join(publicRoot,file)));return}
      if(!session) return json(res,401,{error:'页面已过期，请刷新再来'})
      if(path==='/api/voice-clip' && req.method==='GET') {
        const query=new URL(req.url,origin).searchParams
        const style=query.get('style')||'',name=query.get('name')||''
        const audio=CLIP_STYLES.has(style)&&CLIP_NAME.test(name)?clips.read(style,name):null
        if(!audio?.length)return json(res,404,{error:'没有这段声音'})
        res.writeHead(200,{'content-type':'audio/mpeg','cache-control':'private, max-age=86400','content-length':String(audio.length)});res.end(audio);return
      }
      if(path==='/api/bootstrap' && req.method==='GET') {
        const me=await gateway('/v1/me')
        return json(res,200,{csrf:session.csrf,name:me.principal.name})
      }
      if(!equal(req.headers['x-whale-csrf'],session.csrf)) return json(res,403,{error:'页面已更新，请刷新后再试'})
      if(req.method==='POST' && req.headers.origin!==origin) return json(res,403,{error:'请从鲸鱼娘页面操作'})
      if(path==='/api/voice-services'&&req.method==='GET')return json(res,200,{paid:paidVoiceStatus()})
      if(path==='/api/history' && req.method==='GET') {
        const result=await gateway('/v1/history')
        return json(res,200,{...result,messages:result.messages.map(m=>m.role==='assistant'?{...m,text:formatReply(m.text)}:m)})
      }
      if(/^\/api\/jobs\/[a-f0-9-]{36}$/.test(path) && req.method==='GET') {
        const job=await gateway(path.replace('/api/','/v1/'))
        return json(res,200,job.status==='done'?{...job,text:formatReply(job.text)}:job)
      }
      if(path==='/api/chat' && req.method==='POST') {
        const input=await body(req),faceCue=input.image&&['smile','brow','raisedBrows','downturned','mouthOpen','eyesClosed','nod','shake','neutral'].includes(input.faceCue)?input.faceCue:undefined
        const initiative=['camera-open','idle'].includes(input.initiative)?input.initiative:undefined
        const job=await gateway('/v1/chat',{id:input.id,text:input.text,image:input.image,...(input.useVision===true?{useVision:true}:{}),...(input.realtime===true?{realtime:true}:{}),...(faceCue?{faceCue}:{}),...(initiative?{initiative}:{})})
        return json(res,200,job.status==='done'?{...job,text:formatReply(job.text)}:job)
      }
      if(path==='/api/audio-status'&&req.method==='GET')return json(res,200,audioStatus())
      if(path==='/api/vision-observe'&&req.method==='POST'){const input=await body(req);return json(res,200,await gateway('/v1/vision',{image:input.image}))}
      if(path==='/api/vision-clear'&&req.method==='POST')return json(res,200,await gateway('/v1/vision/clear',{}))
      if(path==='/api/live-chat'&&req.method==='POST'){
        const input=await body(req),controller=new AbortController()
        if(!/^[a-f0-9-]{36}$/.test(input.id||'')||typeof input.text!=='string'||!input.text.trim()||[...input.text].length>2000)return json(res,400,{error:'请输入有效的一句话'})
        const close=()=>{if(!res.writableEnded)controller.abort()};res.on('close',close)
        res.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-accel-buffering':'no'})
        try{for await(const event of liveChat({gateway,id:input.id,text:input.text,image:input.image,useVision:input.useVision===true,faceCue:['smile','brow','raisedBrows','downturned','mouthOpen','eyesClosed','nod','shake','neutral'].includes(input.faceCue)?input.faceCue:undefined,initiative:['camera-open','idle'].includes(input.initiative)?input.initiative:undefined,signal:controller.signal}))res.write(JSON.stringify(event)+'\n')}
        catch(e){if(!controller.signal.aborted)res.write(JSON.stringify({type:'error',error:e.message?.slice(0,180)||'对话中断',...(Number.isInteger(e.status)?{status:e.status}:{})})+'\n')}
        finally{res.off('close',close);res.end()}
        return
      }
      if(path==='/api/transcribe' && req.method==='POST') {const input=await body(req);return json(res,200,{text:await transcribe(input.audio,{trimStartMs:input.trimStartMs??0})})}
      if(path==='/api/speech' && req.method==='POST') {const input=await body(req);return json(res,200,await synthesize(input.text,input.style))}
      if(path==='/api/speech-stream'&&req.method==='POST'){
        const input=await body(req),controller=new AbortController(),started=Date.now()
        const close=()=>{if(!res.writableEnded)controller.abort()};res.on('close',close)
        try{
          for await(const chunk of streamSpeech(input.text,input.style,controller.signal)){
            if(!res.headersSent)res.writeHead(200,{'content-type':'audio/mpeg','cache-control':'no-store','x-whale-first-audio-ms':String(Date.now()-started)})
            res.write(chunk)
          }
          res.end()
        }catch(e){if(res.headersSent)res.destroy();else throw e}
        finally{res.off('close',close)}
        return
      }
      return json(res,404,{error:'没有这个功能'})
    } catch(e) {if(!res.headersSent) json(res,Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:502,{error:e.message?.slice(0,180)||'暂时连不上鲸鱼娘，请稍后再试'});else res.end()}
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=gatewayRoot(), port=servicePort('WHALEGIRL_DESKTOP_PORT',3092)
  const gateway=await desktopClient(root)
  const recognizer=createWarmRecognizer({root:join(root,'pc-audio')})
  const transcribe=createTranscriber({root:join(root,'pc-audio'),decode:recognizer.decode})
  void recognizer.ready().catch(()=>{})
  const synthesize=createSpeaker({root:join(root,'pc-speech')})
  const speechService=createWarmSpeechService()
  void speechService.ready().catch(()=>{})
  const paid=createAliyunVoice({root})
  const server=createServer(desktopApp({gateway,port,transcribe,audioStatus:()=>({...recognizer.status(),speech:speechService.status()}),synthesize:(text,style)=>style==='aliyun'?paid.synthesize(text):synthesize(text,style),streamSpeech:(text,style,signal)=>style==='aliyun'?paid.stream(text,signal):speechService.stream(text,style,signal),paidVoiceStatus:paid.status}))
  server.on('close',recognizer.close)
  server.on('close',speechService.close)
  server.requestTimeout=120000;server.headersTimeout=15000
  server.listen(port,'127.0.0.1',()=>console.log('WhaleGirl desktop ready on loopback port '+port))
}
