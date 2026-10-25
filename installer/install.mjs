import {readFile,writeFile,mkdir,rename,copyFile,readdir,access} from 'node:fs/promises'
import {resolve,join,dirname,basename,isAbsolute} from 'node:path'
import {spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {extractZip,safeChild} from './archive.mjs'
const here=dirname(fileURLToPath(import.meta.url))
const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]}
const installRoot=resolve(get('--root')||''),dataRoot=resolve(get('--data')||''),packageFile=get('--package')
if(!get('--root')||!get('--data')||!packageFile||!isAbsolute(packageFile))throw Error('Explicit installation, data and package paths required')
const cache=resolve(get('--cache')||join(installRoot,'cache')),runtime=join(installRoot,'runtime')
const manifest=JSON.parse(await readFile(join(here,'dependencies.json'),'utf8'))
const step=message=>process.stdout.write('STATUS|'+message+'\n')
const exists=async path=>{try{await access(path);return true}catch{return false}}
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const save=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path+'.tmp',JSON.stringify(value,null,2));await rename(path+'.tmp',path)}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
async function download(item){
 await mkdir(cache,{recursive:true});const target=safeChild(cache,item.file)
 if(await exists(target)){if(sha(await readFile(target))===item.sha256)return target;await rename(target,target+'.rejected-'+randomUUID())}
 for(let attempt=0;attempt<3;attempt++){
  try{
   let url=new URL(item.url),response
   for(let hop=0;hop<9;hop++){
    if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid download origin')
    response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(1200000)})
    if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),url);continue}break
   }
   if(!response?.ok)throw Error('Download HTTP '+response?.status)
   const bytes=Buffer.from(await response.arrayBuffer())
   if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw Error('SHA256 verification failed: '+item.id)
   await writeFile(target+'.download',bytes);await rename(target+'.download',target);return target
  }catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,2000*(attempt+1)))}
 }
}
function run(exe,argv,options={}){
 return new Promise((done,fail)=>{
  const {captureLimit=4000,...spawnOptions}=options
  const proc=spawn(exe,argv,{windowsHide:true,stdio:['ignore','pipe','pipe'],...spawnOptions})
  let tail='';const keep=b=>{tail=(tail+b.toString()).slice(-captureLimit)}
  proc.stdout.on('data',keep);proc.stderr.on('data',keep)
  proc.on('error',fail);proc.on('close',code=>code===0?done(tail):fail(Error(basename(exe)+' failed ('+code+'). '+tail.slice(-800))))
 })
}
await mkdir(installRoot,{recursive:true});const statePath=join(installRoot,'installation.json')
const pendingPath=join(installRoot,'install.inprogress.json')
let previous=await exists(statePath)?await json(statePath):await exists(pendingPath)?await json(pendingPath):null
if(previous&&(previous.product!=='WhaleGirlCompanion'||previous.dataRoot!==dataRoot))throw Error('Existing installation identity differs; data preserved')
if(!previous){const foreign=(await readdir(installRoot)).filter(n=>!['staging','cache','runtime','WhaleGirl.exe'].includes(n));if(foreign.length)throw Error('Choose an empty or existing WhaleGirl installation directory')}
await save(pendingPath,{product:'WhaleGirlCompanion',dataRoot})
const app=join(installRoot,'app',manifest.version+'-'+sha(await readFile(packageFile)).slice(0,12))
step('校验并展开程序文件');const extracted=await extractZip(packageFile,app)
const packageManifest=await json(join(app,'PACKAGE-MANIFEST.json'))
if(!Array.isArray(packageManifest)||packageManifest.length+1!==extracted||new Set(packageManifest.map(f=>f.path)).size!==packageManifest.length)throw Error('Package inventory differs')
for(const file of packageManifest){if(sha(await readFile(safeChild(app,file.path)))!==file.sha256)throw Error('Package file differs: '+file.path)}
if(args.includes('--payload-only')){step('离线程序包校验通过，未改动用户数据');process.exit(0)}
await mkdir(dataRoot,{recursive:true});let identity
if(await exists(join(dataRoot,'product.json'))){identity=await json(join(dataRoot,'product.json'));if(identity.product!=='WhaleGirlCompanion')throw Error('Data directory belongs to another product')}
else{if((await readdir(dataRoot)).length)throw Error('Choose an empty data directory');identity={product:'WhaleGirlCompanion',instance:randomUUID()};await save(join(dataRoot,'product.json'),identity)}
// Restrict this newly managed data folder, never any pre-existing DSH profile.
if(process.platform==='win32'){
 const identityText=await run('whoami.exe',['/user','/fo','csv','/nh']),sid=identityText.match(/S-1-5-21-[0-9-]+/)?.[0]
 if(!sid)throw Error('Cannot identify current Windows user')
 await run('icacls.exe',[dataRoot,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'])
}
const items=Object.fromEntries(manifest.items.map(x=>[x.id,x]))
async function unpack(item,target,required){
 const marker=join(target,'.whale-verified.json')
 let stamp;try{stamp=await json(marker)}catch{}
 if(stamp?.sha256===item.sha256&&await exists(required))return
 await extractZip(await download(item),target);await save(marker,{sha256:item.sha256})
}
const node=join(runtime,'node','node-v24.20.0-win-x64','node.exe'),npm=join(dirname(node),'node_modules/npm/bin/npm-cli.js')
await unpack(items.node,join(runtime,'node'),node)
step('准备独立的 PowerShell 与 Python')
const pwsh=join(runtime,'powershell/pwsh.exe'),python=join(runtime,'python/python.exe')
await unpack(items.powershell,dirname(pwsh),pwsh)
await unpack(items.python,dirname(python),python)
const site=join(runtime,'python/Lib/site-packages')
if(!await exists(join(site,'pip')))await extractZip(await download(items.pip),site)
await writeFile(join(runtime,'python/python312._pth'),'python312.zip\n.\nLib/site-packages\nimport site\n')
process.env.PATH=[dirname(node),dirname(pwsh),process.env.PATH].join(';')
process.env.npm_config_cache=join(cache,'npm')
process.env.npm_config_registry='https://registry.npmjs.org/'
step('准备语音识别和声音依赖');await run(python,['-m','pip','install','--disable-pip-version-check','--index-url','https://pypi.org/simple','--only-binary=:all:',...manifest.pythonPackages])
step('准备音视频工具')
const ffmpeg=join(runtime,'ffmpeg/ffmpeg-7.1.1-essentials_build/bin')
await unpack(items.ffmpeg,join(runtime,'ffmpeg'),join(ffmpeg,'ffmpeg.exe'))
const desktopRuntime=join(runtime,'desktop'),modelRoot=join(desktopRuntime,'models')
step('安装本机视觉组件与模型')
await run(node,[npm,'install','--prefix',join(desktopRuntime,'vision'),'--ignore-scripts','--no-audit','--no-fund','@mediapipe/tasks-vision@'+manifest.mediapipe])
await mkdir(modelRoot,{recursive:true});for(const name of ['hand','face'])await copyFile(await download(items[name]),join(modelRoot,items[name].file))
const modelName='sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
if(!await exists(join(modelRoot,modelName,'.whale-complete'))){
 const archive=await download(items.sensevoice)
 await run(python,[join(here,'unpack-model.py'),archive,modelRoot])
 await writeFile(join(modelRoot,modelName,'.whale-complete'),items.sensevoice.sha256)
}
step('安装独立的 DSH 与长期记忆')
const dshRoot=join(runtime,'dsh')
process.env.DSH_HOME=join(dataRoot,'dsh')
process.env.DSH_TELEMETRY_DISABLED='1'
const dshPackage=join(dshRoot,'package.json'),dshConfig=await exists(dshPackage)?await json(dshPackage):{name:'whalegirl-managed-dsh',private:true}
await save(dshPackage,{...dshConfig,overrides:manifest.dshOverrides})
await run(node,[npm,'install','--prefix',dshRoot,'--no-audit','--no-fund','@deepseek-ai/dsh@'+manifest.dsh])
const dsh=join(dshRoot,'node_modules/@deepseek-ai/dsh/lib/bin.js')
const pack=await run(node,[npm,'pack','--ignore-scripts','--json','--pack-destination',cache],{cwd:join(app,'bridge-src'),captureLimit:2000000})
const packed=JSON.parse(pack)[0].filename
await run(node,[dsh,'plugin','--profile','web','add','--ignore-scripts',join(cache,packed),'meow-memory@'+manifest.memory])
step('建立角色预设与首次配置入口')
const preset=await readFile(join(app,'examples/whale-girl.preset.yml'),'utf8')
await writeFile(join(dataRoot,'managed.patch.yml'),"- id: session-telemetry-otel\n  disabled: true\n- id: desktop-product-telemetry\n  disabled: true\n- id: product-analytics\n  disabled: true\n- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 3180\n- id: qq-bridge\n  config:\n    targetSessionId: ''\n    agentPreset: whale-girl\n    onebotUrl: ''\n    whitelist: []\n    groupWhitelist: []\n"+preset)
await run(node,[npm,'ci','--prefix',join(app,'mobile-gateway'),'--ignore-scripts','--no-audit','--no-fund'])
const launcher=join(installRoot,'launcher');await mkdir(launcher,{recursive:true})
for(const file of await readdir(here)){if(/\.(mjs|json|py)$/.test(file))await copyFile(join(here,file),join(launcher,file))}
await save(statePath,{product:'WhaleGirlCompanion',version:manifest.version,appRoot:app,dataRoot,runtimeRoot:runtime,node,python,pwsh,dsh,ffmpeg,instance:identity.instance,configured:previous?.configured===true})
step('安装完成：首次使用请登录并选择自己的模型')
