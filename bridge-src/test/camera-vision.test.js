import test from 'node:test'
import assert from 'node:assert/strict'
import {createCameraVision} from '../camera-vision.js'
const image=Buffer.from('image').toString('base64')
function setup(stream){
  const calls=[]
  const vision=createCameraVision({llm:{resolveModelInfo:async()=>({reasoning:{efforts:[{id:'low'},{id:'high'}]}}),stream:options=>{calls.push(options);return stream(calls.length)}},attachments:{saveImage:async()=>({id:'fake-image'})},findModel:async()=>({provider:'test',model:'vision'}),createMessage:content=>({role:'user',content}),logger:{warn(){}}})
  return {vision,calls}
}
test('camera vision reserves output room and retries an empty reasoning-only observation before any chat',async()=>{
  const {vision,calls}=setup(async function*(n){if(n===1){yield {type:'reasoning-delta',text:'analysis'};yield {type:'finish',reason:{kind:'max-tokens'}}}else{yield {type:'text-delta',text:'手掌张开，朝向镜头。'};yield {type:'finish',reason:{kind:'stop'}}}})
  assert.equal(await vision.describe(image,'手在做什么'),'手掌张开，朝向镜头。')
  assert.equal(calls.length,2);assert.equal(calls[0].reasoningEffort,'low')
  assert.equal(calls[0].maxTokens,1400);assert.equal(calls[1].maxTokens,2200)
  assert.match(calls[0].messages[0].content[0].text,/手在做什么/)
  assert.equal(vision.status().attempts[0].reasoningChars,8)
  assert.equal(vision.status().ok,true)
})
test('a camera failure stays bounded and does not return partial text from an errored attempt',async()=>{
  const {vision,calls}=setup(async function*(){yield {type:'text-delta',text:'partial'};yield {type:'finish',reason:{kind:'error'}}})
  await assert.rejects(vision.describe(image),/没有返回内容/)
  assert.equal(calls.length,2);assert.equal(vision.status().ok,false)
})
