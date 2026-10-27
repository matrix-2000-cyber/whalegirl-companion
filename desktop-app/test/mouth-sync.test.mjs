import test from 'node:test'
import assert from 'node:assert/strict'
import {createMouthSync} from '../public/mouth-sync.mjs'

test('mouth follows real syllables, closes in gaps, and resets immediately on interruption',()=>{
  const mouth=createMouthSync()
  let pose
  for(let now=0;now<160;now+=16)pose=mouth.update({playing:true,rms:.06,now,mediaTime:now/1000})
  assert.ok(pose.jaw>.8)
  for(let now=160;now<320;now+=16)pose=mouth.update({playing:true,rms:0,now,mediaTime:now/1000})
  assert.equal(pose.jaw,0)
  pose=mouth.update({playing:true,rms:.08,now:336,mediaTime:.336});assert.ok(pose.jaw>0)
  assert.equal(mouth.update({playing:false,rms:.08,now:352}).jaw,0)
})

test('silent, invalid, and stalled audio cannot animate a speaking mouth',()=>{
  for(const rms of [0,.002,NaN,Infinity,-1]){
    const mouth=createMouthSync()
    for(let now=0;now<300;now+=16)assert.equal(mouth.update({playing:true,rms,now,mediaTime:now/1000}).jaw,0)
  }
  const mouth=createMouthSync();let pose
  for(let now=0;now<400;now+=16)pose=mouth.update({playing:true,rms:.08,now,mediaTime:1})
  assert.equal(pose.jaw,0)
})

test('spectral changes alter mouth width without moving the body or using random time cycles',()=>{
  const round=createMouthSync(),wide=createMouthSync();let a,b
  for(let now=0;now<200;now+=16){
    a=round.update({playing:true,rms:.04,bands:[0,.3,.2,.01,.01],now,mediaTime:now/1000})
    b=wide.update({playing:true,rms:.04,bands:[0,.01,.01,.2,.3],now,mediaTime:now/1000})
  }
  assert.ok(a.spread<.1);assert.ok(b.spread>.9);assert.equal(a.jaw,b.jaw)
})
