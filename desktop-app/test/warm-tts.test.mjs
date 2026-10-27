import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough,Writable} from 'node:stream'
import {createWarmSpeechService} from '../warm-tts.mjs'
function fixture(){
 const children=[],messages=[]
 const service=createWarmSpeechService({python:()=>process.execPath,spawnChild:()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough()
  child.stdin=new Writable({write(chunk,_encoding,done){messages.push(JSON.parse(chunk.toString()));done()}})
  child.kill=()=>{};children.push(child);queueMicrotask(()=>child.stdout.write('{"ready":true}\n'));return child
 }})
 const emit=value=>children.at(-1).stdout.write(JSON.stringify(value)+'\n')
 return {service,children,messages,emit}
}
const tick=()=>new Promise(r=>setImmediate(r))
test('speech process stays warm across sentences, streams early, and ignores old request packets',async t=>{
 const f=fixture();t.after(f.service.close);await f.service.ready()
 const first=f.service.stream('第一句'),audio=first.next();await tick();const id=f.messages.at(-1).id
 f.emit({id,audio:Buffer.alloc(512,1).toString('base64')});assert.equal((await audio).value.length,512)
 f.emit({id,done:true});assert.equal((await first.next()).done,true)
 const second=f.service.stream('第二句'),next=second.next();await tick();const secondId=f.messages.at(-1).id
 f.emit({id,audio:Buffer.alloc(512,9).toString('base64')})
 f.emit({id:secondId,audio:Buffer.alloc(512,2).toString('base64')});assert.equal((await next).value[0],2)
 f.emit({id:secondId,done:true});await second.next();assert.equal(f.children.length,1)
})
test('interruption cancels speech without killing the warm service or leaking queued words',async t=>{
 const f=fixture();t.after(f.service.close);const c=new AbortController()
 const first=f.service.stream('不要接着读','cute',c.signal),next=first.next();await tick()
 const id=f.messages.at(-1).id;c.abort();await assert.rejects(next,{name:'AbortError'})
 assert.deepEqual(f.messages.at(-1),{id,cancel:true})
 const second=f.service.stream('新的一句'),data=second.next();await tick();const key=f.messages.at(-1).id
 f.emit({id:key,audio:Buffer.alloc(512).toString('base64')});await data;f.emit({id:key,done:true});await second.next()
 assert.equal(f.children.length,1)
})
test('worker failure releases the queue, can recover, and closed service never restarts',async()=>{
 const f=fixture();const first=f.service.stream('第一句'),next=first.next();await tick()
 f.children[0].emit('exit',1);await assert.rejects(next,/连接中断/)
 await f.service.ready();assert.equal(f.children.length,2);f.service.close();await assert.rejects(f.service.ready(),/连接中断/)
})
test('closing during warmup rejects its waiter and invalid voices never spawn',async()=>{
 const f=fixture();await assert.rejects(f.service.stream('你好','invalid').next(),/请选择/);assert.equal(f.children.length,0)
 const warm=f.service.ready();f.service.close();await assert.rejects(warm,/连接中断/)
})
