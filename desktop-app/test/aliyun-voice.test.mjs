import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createAliyunVoice} from '../aliyun-voice.mjs'
test('domestic paid audio streams hex once, skips aggregate duplicates and keeps credentials server-side',async t=>{
  const root=mkdtempSync(join(tmpdir(),'whale-cny-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
  let calls=0
  const voice=createAliyunVoice({root,readConfig:()=>({enabled:true,key:'private-key',voice:'female-shaonv'}),request:async(url,options)=>{
    calls++;assert.equal(url,'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    assert.equal(options.headers.authorization,'Bearer private-key');const body=JSON.parse(options.body)
    assert.equal(body.model,'MiniMax/speech-2.8-hd');assert.equal(body.input.stream_options.exclude_aggregated_audio,true)
    const events=[{output:{data:{audio:'010203',status:1}}},{output:{data:{audio:'0405',status:1}}},{output:{data:{audio:'0102030405',status:2}}}]
    return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})
  }})
  const result=await voice.synthesize('(chuckle)你好')
  assert.deepEqual([...Buffer.from(result.audio,'base64')],[1,2,3,4,5]);assert.equal(calls,1)
  assert.ok(!JSON.stringify(voice.status()).includes('private-key'))
  assert.ok(JSON.parse(readFileSync(join(root,'paid-voice-usage.json'))).reserved>0)
  await assert.rejects(voice.synthesize('鱼'.repeat(1000)),/上限/);assert.equal(calls,1)
})
test('paid speech cannot run before setup or with an unapproved custom voice',async()=>{
  let called=false
  const make=readConfig=>createAliyunVoice({root:'unused',readConfig,request:()=>{called=true}})
  await assert.rejects(make(()=>({})).synthesize('你好'),/配置/)
  await assert.rejects(make(()=>({enabled:true,key:'key',voice:'clone'})).synthesize('你好'),/只允许预置/)
  assert.equal(called,false)
})
