import test from 'node:test'
import assert from 'node:assert/strict'
import {attentiveMotion,gazeVector,createStandingPolicy,blinkPhase} from '../public/standing-policy.mjs'
test('idle stays frontal for long waits: no random gaze, tilt, or unsolicited clips',()=>{
 let time=0;const policy=createStandingPolicy({now:()=>time})
 for(time=0;time<600000;time+=333){const pose=attentiveMotion(time);assert.equal(pose.x,0);assert.equal(pose.tilt,0);assert.equal(pose.gazeX,0);assert.equal(pose.gazeY,0);assert.equal(pose.feetY,0);assert.ok(Math.abs(pose.y)<=1.5);assert.ok(Math.abs(pose.chestY)<=2.8);assert.equal(policy.tick().action,null)}
 assert.equal(attentiveMotion(200,{reduced:true}).y,0)
 assert.equal(policy.request('look'),false)
})
test('breathing moves chest and head gently, with planted feet and no positional jumps',()=>{
 let previous=attentiveMotion(0),max=0,min=1
 for(let time=16;time<20000;time+=16){const pose=attentiveMotion(time);assert.ok(Math.abs(pose.y-previous.y)<.035);assert.ok(Math.abs(pose.chestY-previous.chestY)<.06);assert.equal(pose.feetY,0);assert.equal(pose.tilt,0);max=Math.max(max,pose.breath);min=Math.min(min,pose.breath);previous=pose}
 assert.ok(max>.99&&min<.01)
})
test('native eyelid sequence closes and opens smoothly, never remains shut',()=>{
 assert.deepEqual([-1,0,30,64,65,90,105,160,210,220,10000].map(blinkPhase),['open','half','half','half','closed','closed','half','half','half','open','open'])
})
test('speaking and finger tracking interrupt actions and queued cues wait without stealing interaction',()=>{
 let time=0;const policy=createStandingPolicy({now:()=>time})
 assert.equal(policy.request('wave'),true)
 assert.equal(policy.tick({busy:true}).action,null)
 assert.equal(policy.tick({gaze:true}).action,null)
 const wave=policy.tick();assert.equal(wave.action,'wave');assert.equal(wave.start,true)
 assert.equal(policy.tick().start,false)
 assert.equal(policy.tick({gaze:true}).interrupted,true)
 assert.equal(policy.tick().action,null)
 assert.equal(policy.request('wave'),false)
 time=13000;assert.equal(policy.request('wave'),true);assert.equal(policy.tick().action,'wave')
 policy.finish('wave');assert.equal(policy.tick().action,null)
})
test('action priority, expiry, deduplication, reduced motion and explicit reset prevent stale autoplay',()=>{
 let time=0;const policy=createStandingPolicy({now:()=>time})
 policy.request('wave');assert.equal(policy.request('smile'),false)
 assert.equal(policy.request('wave'),false)
 time=19000;assert.equal(policy.tick().action,null)
 policy.request('smile');assert.equal(policy.tick({reduced:true}).action,null)
 policy.reset();assert.equal(policy.tick().action,null)
 policy.request('sigh');assert.equal(policy.tick().action,'sigh')
 policy.finish('smile');assert.equal(policy.tick().action,'sigh')
 policy.finish('sigh');assert.equal(policy.tick().action,null)
})
test('finger coordinates remain mirrored upstream, clamp safely and reset to eye contact',()=>{
 assert.deepEqual(gazeVector(null),{x:0,y:0})
 assert.deepEqual(gazeVector({x:NaN,y:0}),{x:0,y:0})
 assert.deepEqual(gazeVector({x:-1,y:4}),{x:-1,y:1})
 assert.deepEqual(gazeVector({x:.8,y:.2}),{x:.6000000000000001,y:-.6})
})
