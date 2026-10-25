import test from 'node:test'
import assert from 'node:assert/strict'
import {faceResponse,replyExpression,createReactionGate} from '../public/interaction-rules.mjs'
import {expressionMotion} from '../public/avatar-motion.mjs'
test('facial cues ask gently instead of declaring moods, and respect expression demonstrations',()=>{
 for(const code of ['smile','brow','downturned','raisedBrows','eyesClosed','nod','shake']){
  const r=faceResponse(code);assert.ok([...r.text].length<=20);assert.notEqual(r.expression,'cry')
  assert.ok(!/你.*(?:生气|伤心|难过)/.test(r.text))
 }
 assert.match(faceResponse('brow',{userText:'我在测试表情，没有生气'}).text,/皱眉的动作/)
 assert.match(faceResponse('smile',{userText:'其实我很难过'}).text,/陪你慢慢聊/)
 assert.equal(replyExpression('别哭，鲸鲸陪着你。'),'concern')
 assert.equal(faceResponse('mouthOpen'),null)
})
test('gestures and face replies share a cooldown; expression transitions fade rather than snap',()=>{
 let clock=0;const gate=createReactionGate({now:()=>clock})
 assert.equal(gate.claim(),true);assert.equal(gate.claim(),false);clock=15000;assert.equal(gate.claim(),true)
 assert.equal(expressionMotion('smile',0).weight,0)
 assert.ok(expressionMotion('curious',500).tilt<0)
 assert.ok(expressionMotion('concern',1000).brow>0)
 assert.equal(expressionMotion('cry',3200).tears,0)
})
