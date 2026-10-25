import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {openSync,closeSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {connect} from 'node:net'
const root=resolve(process.argv[2]||'')
const state=JSON.parse(await readFile(join(root,'installation.json'),'utf8'))
if(state.product!=='WhaleGirlCompanion')throw Error('Installation identity mismatch')
const data=state.dataRoot,logs=join(data,'logs'),gateway=join(data,'.mobile-gateway')
await mkdir(logs,{recursive:true});await mkdir(gateway,{recursive:true})
const env={...process.env,DSH_HOME:join(data,'dsh'),DSH_TELEMETRY_DISABLED:'1',WHALEGIRL_ROOT:state.appRoot,WHALEGIRL_RUNTIME_ROOT:join(state.runtimeRoot,'desktop'),WHALEGIRL_STATE_ROOT:gateway,
 WHALEGIRL_DSH_PORT:'3180',WHALEGIRL_GATEWAY_PORT:'3191',WHALEGIRL_DESKTOP_PORT:'3192',WHALEGIRL_MANAGED:'1',WHALEGIRL_MANAGED_WORKSPACE:join(data,'workspace'),WHALEGIRL_INSTANCE_ID:state.instance,
 QQ_BRIDGE_ASR_PYTHON:state.python,QQ_BRIDGE_TTS_SCRIPT:join(state.appRoot,'desktop-app/tts.py'),MEET_MODELS:join(state.runtimeRoot,'desktop/models')}
env.PATH=[dirname(state.node),dirname(state.pwsh),state.ffmpeg,env.PATH].join(';')
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const step=s=>process.stdout.write('STATUS|'+s+'\n')
const listening=port=>new Promise(done=>{const s=connect(port,'127.0.0.1');s.setTimeout(1000);s.on('connect',()=>{s.destroy();done(true)});s.on('error',()=>done(false));s.on('timeout',()=>{s.destroy();done(false)})})
async function start(name,exe,args){
 const stdout=openSync(join(logs,name+'.log'),'a'),stderr=openSync(join(logs,name+'-error.log'),'a')
 const child=spawn(exe,args,{cwd:state.appRoot,env,windowsHide:true,detached:true,stdio:['ignore',stdout,stderr]})
 await new Promise((done,fail)=>{child.once('spawn',done);child.once('error',fail)})
 closeSync(stdout);closeSync(stderr);child.unref()
 await writeFile(join(logs,name+'.pid.json'),JSON.stringify({pid:child.pid,instance:state.instance,started:new Date().toISOString()}))
}
step('启动独立的对话与记忆服务')
if(!await listening(3180))await start('dsh',state.node,[state.dsh,'--profile','web','--patch',join(data,'managed.patch.yml'),'--no-open'])
let ready=false
for(let i=0;i<90;i++){
 try{const r=await fetch('http://127.0.0.1:3180/api/qq-bridge/runtime',{signal:AbortSignal.timeout(2000)});const value=await r.json();if(value.managedInstance!==state.instance)throw Error('Another service occupies port 3180');ready=true;break}catch(e){if(String(e).includes('Another service'))throw e}
 await sleep(1000)
}
if(!ready)throw Error('对话服务尚未启动，请查看本机日志')
const tlsPath=join(gateway,'tls.json')
try{await readFile(tlsPath)}catch(e){
 if(e.code!=='ENOENT')throw e
 const require=createRequire(join(state.appRoot,'mobile-gateway/package.json'))
 const pems=await require('selfsigned').generate([{name:'commonName',value:'WhaleGirl Local'}],{days:365,keySize:2048,algorithm:'sha256'})
 await writeFile(tlsPath,JSON.stringify({key:pems.private,cert:pems.cert}),{mode:0o600,flag:'wx'})
}
step('启动语音与画面服务')
if(!await listening(3191))await start('gateway',state.node,[join(state.appRoot,'mobile-gateway/server.mjs')])
for(let i=0;i<20&&!await listening(3191);i++)await sleep(500)
if(!await listening(3192))await start('desktop',state.node,[join(state.appRoot,'desktop-app/server.mjs')])
ready=false
for(let i=0;i<45;i++){
 try{const r=await fetch('http://127.0.0.1:3192/health',{signal:AbortSignal.timeout(1000)});const value=await r.json();if(value.instance!==state.instance)throw Error('Another service occupies port 3192');ready=true;break}catch(e){if(String(e).includes('Another service'))throw e}await sleep(1000)
}
if(!ready)throw Error('网页服务尚未启动，请查看本机日志')
step(state.configured?'鲸鱼娘已准备好':'首次使用：请先打开模型设置，登录并选择可用模型')
