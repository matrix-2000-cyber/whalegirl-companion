import test from 'node:test'
import assert from 'node:assert/strict'
import {blinkClosure,eyelidShape} from '../public/standing-policy.mjs'
test('blink is continuous, closes once, and returns fully open',()=>{
  for(const t of [-Infinity,-1,0,220,1000,NaN])assert.equal(blinkClosure(t),0)
  let previous=0
  for(let t=0;t<=65;t++){const p=blinkClosure(t);assert.ok(p>=previous&&p<=1);assert.ok(p-previous<.025);previous=p}
  for(let t=65;t<=105;t++)assert.equal(blinkClosure(t),1)
  for(let t=105;t<=220;t++){const p=blinkClosure(t);assert.ok(p<=previous&&p>=0);assert.ok(previous-p<.015);previous=p}
})
test('eyelids never cross or shift sideways and meet exactly at closure',()=>{
  for(let i=0;i<=100;i++){const s=eyelidShape(i/100);assert.ok(s.upper<=s.lower);assert.ok(Math.abs(s.left-s.right-1)<1e-12);assert.equal(s.span,15)}
  const closed=eyelidShape(1);assert.equal(closed.upper,closed.lower)
})
