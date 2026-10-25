import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createWarmRecognizer} from '../warm-asr.mjs'
test('one warm worker serves repeated utterances without reloading the model',async()=>{
 let spawns=0,killed=false
 const worker=createWarmRecognizer({root:'.mobile-gateway/test',spawnChild:()=>{
  spawns++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr={resume(){}}
  child.stdin={write(line,callback){const input=JSON.parse(line);queueMicrotask(()=>child.stdout.emit('data',JSON.stringify({id:input.id,text:'你好',decodeMs:42})+'\n'));callback?.()}}
  child.kill=()=>{killed=true};queueMicrotask(()=>child.stdout.emit('data','{"ready":true,"loadMs":100}\n'));return child
 }})
 await worker.ready();assert.equal(await worker.decode('test.wav'),'你好');assert.equal(await worker.decode('second.wav'),'你好')
 assert.equal(spawns,1);assert.equal(worker.status().lastDecodeMs,42);worker.close();assert.equal(killed,true)
 await assert.rejects(worker.ready(),/已停止/)
})
