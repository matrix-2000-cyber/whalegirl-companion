import test from 'node:test'
import assert from 'node:assert/strict'
import {createInitiative} from '../public/initiative.mjs'
test('camera opener waits for video, respects busy/draft gates and never repeats unanswered',()=>{
 let clock=0,saved=[]
 const p=createInitiative({now:()=>clock,save:at=>saved.push(at)})
 p.open()
 assert.equal(p.next({ready:false,available:true,enabled:true}),null)
 assert.equal(p.next({ready:true,available:false,enabled:true}),null)
 const active={ready:true,available:true,enabled:true}
 assert.equal(p.next(active),'camera-open')
 clock=180000;assert.equal(p.next(active),null)
 p.userTurn();clock+=59000;assert.equal(p.next(active),null)
 clock+=1000;assert.equal(p.next(active),'idle')
 clock+=360000;assert.equal(p.next(active),null)
 p.close();p.userTurn();clock+=360000;assert.equal(p.next(active),null)
 assert.equal(saved.length,2)
})
test('rapid camera reopen, disabled mode and recent user activity suppress interruptions',()=>{
 let clock=100000
 const p=createInitiative({now:()=>clock,lastAt:95000}),active={ready:true,available:true,enabled:true}
 p.open();assert.equal(p.next(active),null)
 clock=190000;assert.equal(p.next({...active,enabled:false}),null)
 assert.equal(p.next(active),'camera-open')
 p.close();p.open();clock+=1000;assert.equal(p.next(active),null)
 p.userTurn();clock+=91000;p.activity();assert.equal(p.next(active),null)
 clock+=60000;assert.equal(p.next(active),'idle')
})
