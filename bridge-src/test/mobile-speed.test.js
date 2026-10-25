import test from 'node:test'
import assert from 'node:assert/strict'
import {mobileChatRequestConfig,restoreResumeReasoning} from '../token-policy.js'
test('fast companion chat leaves memory maintenance, other providers and complex turns alone',()=>{
  const config={provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'high'}
  assert.equal(mobileChatRequestConfig(config,{record:{fastChat:true}}).reasoningEffort,'off')
  assert.equal(mobileChatRequestConfig(config,{record:{fastChat:false}}),config)
  assert.equal(mobileChatRequestConfig(config,{record:{fastChat:true,maintenance:true}}),config)
  assert.equal(mobileChatRequestConfig(config,{record:{fastChat:true},agent:{inbox:{nextTurn:[{text:'[meow-memory-reflect]'}]}}}),config)
  const other={...config,provider:'other'};assert.equal(mobileChatRequestConfig(other,{record:{fastChat:true}}),other)
  assert.equal(restoreResumeReasoning({...config,reasoningEffort:'off'},{...config,sessionId:'owner'},'owner').reasoningEffort,'high')
})
