import test from 'node:test'
import assert from 'node:assert/strict'
import {createReplyPlayer} from '../public/reply-player.mjs'
import {requiresCurrentFrame} from '../public/video-observer.mjs'
test('next sentence prepares while the first is playing and order is preserved',async()=>{
 const prepared=[],played=[];let release
 const player=createReplyPlayer({prepare:text=>{prepared.push(text);return Promise.resolve(text)},play:async(text,response)=>{assert.equal(await response,text);played.push(text);if(text==='第一句')await new Promise(r=>release=r)}})
 player.push('第一句');player.push('第二句');await Promise.resolve();await Promise.resolve()
 assert.deepEqual(prepared,['第一句','第二句']);assert.deepEqual(played,['第一句'])
 release();await player.finish();assert.deepEqual(played,['第一句','第二句'])
})
test('abort discards queued sentences rather than speaking them after an interruption',async()=>{
 const controller=new AbortController(),played=[];let release
 const player=createReplyPlayer({signal:controller.signal,prepare:()=>undefined,play:async text=>{played.push(text);await new Promise(r=>release=r)}})
 player.push('第一句');player.push('第二句');controller.abort();release();await player.finish();assert.deepEqual(played,['第一句'])
})
test('questions needing current visual details always request a fresh frame',()=>{
 for(const text of ['我手里是什么','我现在穿什么衣服','看看我','这是几个手指'])assert.equal(requiresCurrentFrame(text),true)
 assert.equal(requiresCurrentFrame('今天聊点什么'),false)
})
