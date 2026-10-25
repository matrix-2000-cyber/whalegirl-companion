import test from 'node:test'
import assert from 'node:assert/strict'
import {createBargeInDetector} from '../public/barge-in.mjs'
const voice={rms:.08,bands:[.2,.8,.5,.1,.03,.01]},other={rms:.07,bands:[.01,.02,.03,.1,.6,.9],playing:true}
test('silence, clicks, disabled devices and similar speaker echo cannot interrupt',()=>{
 const d=createBargeInDetector()
 for(let now=0;now<3000;now+=60){
  assert.equal(d.update({mic:voice,output:{...voice,playing:true},active:true,enabled:true,now}),null)
 }
 d.reset();assert.equal(d.update({mic:voice,active:true,enabled:false,now:4000}),null)
 d.reset();d.update({mic:{rms:0,bands:[]},active:true,enabled:true,now:5000})
 assert.equal(d.update({mic:voice,output:other,active:true,enabled:true,now:5400}),null)
 assert.equal(d.update({mic:{rms:0,bands:[]},active:true,enabled:true,now:5460}),null)
})
test('sustained distinct residual speech triggers once and keeps a pre-roll boundary',()=>{
 const d=createBargeInDetector();let event=null
 for(let now=0;now<=720;now+=60)event=d.update({mic:voice,output:other,active:true,enabled:true,now})||event
 assert.ok(event);assert.equal(event.detectedAt-event.startedAt,300);assert.equal(event.trimLeadMs,250)
 assert.equal(d.update({mic:voice,output:other,active:true,enabled:true,now:900}),null)
 d.reset();assert.equal(d.update({mic:voice,output:other,active:true,enabled:true,now:1000}),null)
})
