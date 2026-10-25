import test from 'node:test'
import assert from 'node:assert/strict'
import {withVisionFallback} from '../vision-fallback.mjs'
test('empty camera analysis continues once without image, retaining identity and original words',async()=>{
  const calls=[],principal={id:'owner',role:'owner'}
  const result=await withVisionFallback({principal,text:'能听见我吗',image:'image'},async input=>{
    calls.push(input);return calls.length===1?{ok:false,error:'画面识别没有返回内容'}:{ok:true,text:'听得到，本鱼在呢。'}
  })
  assert.equal(calls.length,2);assert.equal(calls[1].image,undefined)
  assert.equal(calls[1].principal,principal);assert.match(calls[1].text,/能听见我吗/)
  assert.match(calls[1].text,/不要猜测画面/);assert.equal(result.vision.status,'unavailable')
  assert.equal(result.text,'听得到，本鱼在呢。')
})
test('successful image analysis is untouched; uncertain failures are never replayed',async()=>{
  const success={ok:true,text:'看到你的手了。'}
  assert.equal(await withVisionFallback({image:'image'},async()=>success),success)
  let count=0
  await assert.rejects(withVisionFallback({text:'hello',image:'image'},async()=>{count++;throw Error('Network timeout')}),/Network timeout/)
  assert.equal(count,1)
  count=0
  await assert.rejects(withVisionFallback({text:'hello',image:'image'},async()=>{count++;return {ok:false,error:'回复等待超时'}}),/回复等待超时/)
  assert.equal(count,1)
})
