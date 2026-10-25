import test from 'node:test'
import assert from 'node:assert/strict'
import {fingertipTarget,createWaveDetector,openPalm} from '../public/hand-rules.mjs'
const palm=(x=.5)=>{
  const p=Array.from({length:21},()=>({x,y:.6}))
  p[0]={x,y:.9};p[9]={x,y:.6}
  for(const i of [8,12,16,20]){p[i]={x,y:.2};p[i-2]={x,y:.55}}
  return p
}
test('finger gaze follows the mirrored preview and rejects missing or invalid tips',()=>{
  const p=palm(.2);assert.deepEqual(fingertipTarget(p),{x:.8,y:.2})
  assert.equal(fingertipTarget(null),null)
  p[8].x=NaN;assert.equal(fingertipTarget(p),null)
})
test('greeting requires a real back-and-forth open palm, with a cooldown',()=>{
  const wave=createWaveDetector()
  assert.equal(openPalm(palm()),true)
  for(let i=0;i<15;i++)assert.equal(wave.update(palm(.5),i*100),false)
  const xs=[.3,.4,.5,.6,.5,.4,.3,.4,.5,.6]
  const accepted=xs.map((x,i)=>wave.update(palm(x),2000+i*100))
  assert.equal(accepted.filter(Boolean).length,1)
  assert.ok(xs.every((x,i)=>!wave.update(palm(x),4000+i*100)))
  wave.reset();assert.equal(wave.update(null,20000),false)
})
