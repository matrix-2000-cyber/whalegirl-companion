import test from 'node:test'
import assert from 'node:assert/strict'
import {createVisionCache} from '../vision-cache.mjs'
test('old or cleared observations cannot describe a new camera visit',async()=>{
 let clock=1000,finish,calls=0;const cache=createVisionCache({now:()=>clock})
 const pending=cache.observe('a','image',()=>{calls++;return new Promise(r=>finish=r)})
 assert.equal((await cache.observe('a','second',()=>{calls++})).busy,true)
 cache.clear('a');finish({text:'旧画面'});await pending;assert.equal(cache.read('a'),null)
 clock+=4000;await cache.observe('a','third',async()=>({text:'新画面'}));assert.equal(cache.read('a').text,'新画面')
 assert.equal(cache.read('b'),null);clock+=10001;assert.equal(cache.read('a'),null);assert.equal(calls,1)
})
