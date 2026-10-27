import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareTurnVision,createVideoObserver} from '../public/video-observer.mjs'
test('a new user turn recaptures after waiting and never substitutes a background observation',()=>{
 let live='before';const input={image:'old',sharing:true,capture:()=>live,initiative:false,fresh:true,text:'像不像呀'}
 live='after';assert.deepEqual(prepareTurnVision(input),{image:'after',useVision:false})
 assert.deepEqual(prepareTurnVision({...input,sharing:false,capture:()=>assert.fail('camera closed')}),{image:undefined,useVision:false})
 assert.equal(prepareTurnVision({...input,initiative:true,text:'看看我现在拿着什么'}).useVision,false)
 assert.equal(prepareTurnVision({...input,initiative:true,text:'聊两句'}).useVision,true)
})
test('background cadence counts analysis time, expires old frames, and never overlaps slow requests',async()=>{
 for(const duration of [1200,6500]){
  let clock=0;const tasks=[]
  const observer=createVideoObserver({now:()=>clock,schedule:(run,delay)=>{tasks.push({run,delay});return tasks.length},cancel(){},clear:async()=>{},capture:()=> 'frame',observe:async()=>{const observedAt=clock;clock+=duration;return {observation:{observedAt,text:'snapshot'}}}})
  observer.start();assert.equal(tasks[0].delay,400);clock=400;await tasks.shift().run()
  assert.equal(tasks[0].delay,Math.max(250,5000-duration))
  assert.equal(observer.fresh(),duration<=2500)
  clock+=10000;assert.equal(observer.fresh(),false);observer.stop();assert.equal(observer.get(),null)
 }
})
