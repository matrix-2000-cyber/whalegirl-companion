import test from 'node:test'
import assert from 'node:assert/strict'
import {createFaceObserver,headPose} from '../public/face-rules.mjs'
const scores=values=>Object.entries(values).map(([categoryName,score])=>({categoryName,score}))
test('face observations need sustained actions, react once, and clear when the face is lost',()=>{
  const observer=createFaceObserver(),smile=scores({mouthSmileLeft:.8,mouthSmileRight:.8})
  assert.equal(observer.update(smile,0).code,null)
  const stable=observer.update(smile,900);assert.equal(stable.code,'smile');assert.equal(stable.react,true)
  assert.equal(observer.update(smile,2000).react,false)
  assert.equal(observer.update(smile,22000).react,false)
  assert.equal(observer.update(null,23000).code,null)
  assert.equal(observer.update(smile,24000).react,false)
  assert.equal(observer.update(smile,25000).react,true)
})
test('brow and closed eyes are observable labels rather than claimed anger or sadness',()=>{
  const observer=createFaceObserver(),brow=scores({browDownLeft:.8,browDownRight:.8})
  observer.update(brow,0);const state=observer.update(brow,1000)
  assert.equal(state.code,'brow');assert.equal(state.label,'眉部收紧');assert.equal(state.react,true)
  observer.reset();const closed=scores({eyeBlinkLeft:.9,eyeBlinkRight:.9});observer.update(closed,0)
  assert.equal(observer.update(closed,1000).code,null)
  assert.equal(observer.update(closed,2000).code,'eyesClosed')
})

test('raised eyebrows and downturned corners are separate from opening the mouth',()=>{
 for(const [values,code] of [[{browInnerUp:.8},'raisedBrows'],[{mouthFrownLeft:.7,mouthFrownRight:.7},'downturned'],[{jawOpen:.8},'mouthOpen']]){
  const o=createFaceObserver();o.update(scores(values),0)
  assert.equal(o.update(scores(values),900).code,code)
 }
})
test('session baseline learns quiet faces; disappearing signals and faces clear stale cues',()=>{
 const o=createFaceObserver(),neutral=scores({mouthSmileLeft:.15,mouthSmileRight:.15})
 for(let i=0;i<20;i++)o.update(neutral,i*220)
 assert.equal(o.update(neutral,4500).calibrated,true)
 o.update(scores({browInnerUp:.9}),5000);o.update(scores({browInnerUp:.9}),6000)
 for(let i=0;i<12;i++)o.update(neutral,6500+i*220)
 assert.equal(o.update(neutral,9400).code,'neutral')
 assert.equal(o.update(null,9500).code,null)
})
test('complete nod and shake cycles are recognized; one sideways glance is not a shake',()=>{
 const neutral=scores({_neutral:1}),o=createFaceObserver()
 const pose=(pitch,yaw)=>({pitch,yaw})
 o.update(neutral,0,pose(0,0));o.update(neutral,200,pose(.2,0))
 assert.equal(o.update(neutral,500,pose(0,0)).code,'nod')
 o.reset();o.update(neutral,1000,pose(0,0));o.update(neutral,1200,pose(0,.22))
 assert.notEqual(o.update(neutral,1500,pose(0,0)).code,'shake')
 o.update(neutral,1700,pose(0,-.22));assert.equal(o.update(neutral,1900,pose(0,0)).code,'shake')
 assert.deepEqual(headPose([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),{pitch:0,yaw:-0})
 assert.equal(headPose([NaN]),null)
})
