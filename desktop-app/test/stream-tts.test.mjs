import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {mkdtempSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSpeechStreamer} from '../tts.mjs'
test('speech yields its first bytes before synthesis ends, and interruption cleans up the process and text',async t=>{
  const root=mkdtempSync(join(tmpdir(),'whale-stream-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
  let child,killed=false
  const stream=createSpeechStreamer({root,python:()=>process.execPath,spawnChild:(_cmd,args)=>{
    assert.equal(args[2],'-')
    child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null
    child.kill=()=>{killed=true;child.stdout.destroy();child.emit('close',0)}
    queueMicrotask(()=>child.stdout.write(Buffer.alloc(512,1)))
    return child
  }})
  const audio=stream('你好','cute'),first=await audio.next()
  assert.equal(first.done,false);assert.equal(first.value.length,512)
  assert.equal(killed,false);assert.equal(readdirSync(root).length,1)
  await audio.return();assert.equal(killed,true);assert.deepEqual(readdirSync(root),[])
})
test('streamed speech validates the voice before spawning a subprocess',async()=>{
  let spawned=false
  const stream=createSpeechStreamer({root:'unused',spawnChild:()=>{spawned=true}})
  await assert.rejects(stream('你好','bad').next(),/请选择/)
  assert.equal(spawned,false)
})
