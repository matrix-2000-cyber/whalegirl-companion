import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopApp } from '../server.mjs'
import { createTranscriber } from '../audio.mjs'
import { createSpeaker } from '../tts.mjs'

test('desktop is no-QR but requires a local session and CSRF; remote pages cannot send', async t => {
  let handler;const calls=[]
  const server=createServer((req,res)=>handler(req,res))
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const port=server.address().port,origin='http://127.0.0.1:'+port
  handler=desktopApp({port,gateway:async(path,data)=>{calls.push({path,data});return path==='/v1/me'?{principal:{name:'爸爸'}}:path==='/v1/history'?{messages:[]}:{status:'done',text:'在呀～'}},transcribe:async()=> '你好',synthesize:async(text,style)=>{calls.push({speech:text,style});return {audio:'fake',mime:'audio/mpeg'}},streamSpeech:async function*(){yield Buffer.from('audio-');yield Buffer.from('stream')}})
  t.after(()=>new Promise(r=>server.close(r)))
  const request=(path,headers={},data)=>new Promise((resolve,reject)=>{
    const req=httpRequest(origin+path,{method:data?'POST':'GET',headers:{'content-type':'application/json',...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>Buffer.concat(chunks).toString('utf8'),json:async()=>JSON.parse(Buffer.concat(chunks).toString('utf8'))}))
    });req.on('error',reject);req.end(data?JSON.stringify(data):undefined)
  })
  assert.equal((await request('/api/bootstrap')).status,401)
  const page=await request('/')
  assert.match(page.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/)
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/)
  const cookie=page.headers.get('set-cookie').split(';')[0]
  const boot=await(await request('/api/bootstrap',{cookie})).json()
  assert.equal(boot.name,'爸爸')
  assert.deepEqual(Object.keys(boot).sort(),['csrf','name'])
  const valid={cookie,origin,'x-whale-csrf':boot.csrf}
  assert.equal((await request('/api/chat',{cookie,origin},{text:'missing csrf'})).status,403)
  assert.equal((await request('/api/speech',{cookie,origin},{text:'missing csrf'})).status,403)
  assert.equal((await request('/api/speech-stream',{cookie,origin},{text:'missing csrf'})).status,403)
  const streamed=await request('/api/speech-stream',valid,{text:'你好',style:'cute'})
  assert.equal(streamed.status,200);assert.equal(streamed.headers.get('content-type'),'audio/mpeg');assert.equal(await streamed.text(),'audio-stream')
  assert.equal((await request('/api/speech',{...valid,origin:'https://attacker.invalid'},{text:'cross site'})).status,403)
  assert.equal((await request('/api/speech',valid,{text:'你好',style:'cute'})).status,200)
  assert.deepEqual(calls.at(-1),{speech:'你好',style:'cute'})
  assert.equal((await request('/api/chat',{...valid,origin:'https://attacker.invalid'},{text:'cross site'})).status,403)
  assert.equal((await request('/api/chat',{...valid,'sec-fetch-site':'cross-site'},{text:'cross site'})).status,403)
  assert.equal((await request('/api/history',{...valid,host:'attacker.invalid:'+port})).status,403)
  assert.equal((await request('/api/chat',valid,{id:'test',text:'hello',principal:{role:'owner',id:'arbitrary'}})).status,200)
  assert.equal(calls.at(-1).data.principal,undefined)
  assert.equal(calls.at(-1).path,'/v1/chat')
  await request('/api/chat',valid,{id:'event',text:'主动陪聊',initiative:'camera-open'})
  assert.equal(calls.at(-1).data.initiative,'camera-open')
  assert.equal((await request('/local/invite',valid,{principal:{role:'owner'}})).status,404)
  assert.equal((await request('/',{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'})).status,200)
})

test('speech validates voice choices and removes reply text and audio after success or failure',async t=>{
  const root=mkdtempSync(join(tmpdir(),'whale-pc-tts-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
  let fail=false
  const speaker=createSpeaker({root,python:()=>process.execPath,run:async(_command,args)=>{
    assert.ok(['cute','gentle'].includes(args[3]))
    if(fail)throw Error('private provider diagnostic')
    writeFileSync(args[2],Buffer.alloc(512,1));return {stdout:''}
  }})
  const result=await speaker('你好')
  assert.equal(result.voice,'晓伊 · 轻柔可爱')
  assert.equal(Buffer.from(result.audio,'base64').length,512)
  assert.deepEqual(readdirSync(root),[])
  await assert.rejects(speaker('你好','../../invalid'),/请选择/)
  await assert.rejects(speaker('x'.repeat(2001)),/2000/)
  fail=true
  await assert.rejects(speaker('你好'),/声音暂时没生成/)
  assert.deepEqual(readdirSync(root),[])
  fail=false
  assert.equal((await speaker('你好','gentle')).voice,'晓晓 · 温柔自然')
})

test('local ASR uses generated files, Chinese mode, bounded duration, and cleans up', async t => {
  const root=mkdtempSync(join(tmpdir(),'whale-pc-asr-')),script=join(root,'fake-asr.py'),cache=join(root,'cache')
  writeFileSync(script,'fake')
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const calls=[]
  const transcribe=createTranscriber({root:cache,script,python:()=>process.execPath,run:async(command,args)=>{
    calls.push({command,args})
    if(command===process.execPath)writeFileSync(args[args.indexOf('--out')+1],'[00:00:01] 你好鲸鱼娘')
    return {stdout:''}
  }})
  const wav=Buffer.alloc(100);wav.write('RIFF')
  assert.equal(await transcribe(wav.toString('base64')),'你好鲸鱼娘')
  assert.ok(calls[0].args.includes('file,pipe'))
  assert.ok(calls[0].args.includes('30'))
  assert.deepEqual(calls[1].args.slice(-2),['--lang','zh'])
  assert.deepEqual(readdirSync(cache),[])
  await transcribe(wav.toString('base64'),{trimStartMs:1250})
  const trimmed=calls[2].args
  assert.equal(trimmed[trimmed.indexOf('-ss')+1],'1.250')
  assert.ok(trimmed.indexOf('-ss')>trimmed.indexOf('-i'))
  await assert.rejects(transcribe(wav.toString('base64'),{trimStartMs:-1}),/起点无效/)
  await assert.rejects(transcribe(wav.toString('base64'),{trimStartMs:Infinity}),/起点无效/)
  await assert.rejects(transcribe('http://example.com/evil'),/格式不支持/)
  await assert.rejects(transcribe(Buffer.alloc(100).toString('base64')),/格式不支持/)
})

test('voice clips need a session, follow the injected whitelist and never leak paths', async t => {
  let handler
  const server=createServer((req,res)=>handler(req,res))
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const port=server.address().port,origin='http://127.0.0.1:'+port
  const audio=Buffer.from('ID3voice-clip')
  handler=desktopApp({port,gateway:async()=>({principal:{name:'爸爸'}}),transcribe:async()=>'你好',synthesize:async()=>({audio:'fake',mime:'audio/mpeg'}),streamSpeech:async function*(){yield Buffer.from('x')},clips:{read(style,name){return style==='cute'&&name==='laugh_1'?audio:null}}})
  t.after(()=>new Promise(r=>server.close(r)))
  const request=(path,headers={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(origin+path,{method:'GET',headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const buffer=Buffer.concat(chunks);resolve({status:res.statusCode,headers:new Headers(res.headers),buffer})})
    });req.on('error',reject);req.end()
  })
  assert.equal((await request('/health')).status,200)
  assert.equal((await request('/api/voice-clip?style=cute&name=laugh_1')).status,401)
  const cookie=(await request('/')).headers.get('set-cookie').split(';')[0]
  const clip=await request('/api/voice-clip?style=cute&name=laugh_1',{cookie})
  assert.equal(clip.status,200)
  assert.equal(clip.headers.get('content-type'),'audio/mpeg')
  assert.equal(clip.headers.get('cache-control'),'private, max-age=86400')
  assert.equal(Number(clip.headers.get('content-length')),audio.length)
  assert.deepEqual(clip.buffer,audio)
  assert.equal((await request('/api/voice-clip?style=cute&name=laugh_2',{cookie})).status,404)
  assert.equal((await request('/api/voice-clip?style=robot&name=laugh_1',{cookie})).status,404)
  assert.equal((await request('/api/voice-clip?name=laugh_1',{cookie})).status,404)
  for(const name of ['../manifest.json','..%2F..%2Fserver.mjs','laugh_1.mp3','../laugh_1','Laugh_1','laugh-1']){
    const response=await request(`/api/voice-clip?style=cute&name=${name}`,{cookie})
    assert.equal(response.status,404,name)
    assert.deepEqual(JSON.parse(response.buffer.toString('utf8')),{error:'没有这段声音'})
  }
  assert.equal((await request('/api/voice-clip?style=cute%2F..%2Fgentle&name=laugh_1',{cookie})).status,404)
  assert.equal((await request('/health')).status,200)
  assert.equal((await request('/voice-emotion.mjs')).status,200)
})

test('clip reader follows the manifest, rejects traversal and caches the manifest', async t => {
  const {createClipReader}=await import('../server.mjs')
  const manifest={version:1,styles:{},clips:[
    {name:'laugh_1',label:'笑',group:'laugh',style:'cute',file:'cute/laugh_1.mp3',ms:900,bytes:9},
    {name:'escape',style:'cute',file:'../escape.mp3'},
    {name:'absolute',style:'cute',file:'/windows/system32/secret.mp3'},
    {name:'wrong_style',style:'robot',file:'cute/laugh_1.mp3'},
  ],groups:{laugh:['laugh_1']}}
  const files=new Map([['cute/laugh_1.mp3',Buffer.from('clip-bytes')],['../escape.mp3',Buffer.from('secret')]])
  let time=0,manifestReads=0
  const readFile=(path)=>{
    const flat=String(path).replace(/\\/g,'/')
    if(flat.endsWith('manifest.json')){manifestReads++;return JSON.stringify(manifest)}
    for(const [key,value] of files)if(flat.endsWith(key))return value
    throw Error('ENOENT')
  }
  const reader=createClipReader({dir:'C:/voice-clips',now:()=>time,readFile})
  assert.equal(reader.read('cute','laugh_1').toString(),'clip-bytes')
  assert.equal(reader.read('cute','escape'),null)
  assert.equal(reader.read('cute','absolute'),null)
  assert.equal(reader.read('cute','wrong_style'),null)
  assert.equal(reader.read('robot','laugh_1'),null)
  assert.equal(reader.read('cute','../server'),null)
  assert.equal(reader.read('cute','missing_1'),null)
  assert.equal(manifestReads,1)
  time=5*60*1000-1;reader.read('cute','missing_1')
  assert.equal(manifestReads,1)
  time=5*60*1000+1;reader.read('cute','missing_1')
  assert.equal(manifestReads,2)
  const broken=createClipReader({dir:'C:/voice-clips',readFile:()=>'{not json'})
  assert.equal(broken.read('cute','laugh_1'),null)
  const empty=createClipReader({dir:'C:/voice-clips',readFile:()=>{throw Error('ENOENT')}})
  assert.equal(empty.read('cute','laugh_1'),null)
  assert.equal(empty.read('cute','laugh_1'),null)
})
