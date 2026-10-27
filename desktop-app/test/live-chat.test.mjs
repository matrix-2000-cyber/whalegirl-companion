import test from 'node:test'
import assert from 'node:assert/strict'
import {liveChat} from '../live-chat.mjs'
import {createSentenceFeed} from '../public/sentence-feed.mjs'
test('partial assistant text is emitted before turn completion without repeating the request',async()=>{
 let calls=0,polls=0;const events=[]
 const gateway=async(path,input)=>{if(path==='/v1/chat'){calls++;assert.equal(input.realtime,true);return {status:'pending'}}polls++;return polls===1?{status:'pending',partial:'你好呀。'}:{status:'done',text:'你好呀。今天开心吗？'}}
 for await(const event of liveChat({gateway,id:'test',text:'你好',pollMs:1}))events.push(event)
 assert.equal(calls,1);assert.deepEqual(events.map(e=>e.type),['accepted','text','text','done'])
})
test('sentence feed holds fragments, speaks completed sentences once and rejects rewrites',()=>{
 const feed=createSentenceFeed();assert.deepEqual(feed.update('你好'),[])
 assert.deepEqual(feed.update('你好呀。今天'),['你好呀。'])
 assert.deepEqual(feed.update('你好呀。今天好吗？'),['今天好吗？'])
 assert.deepEqual(feed.update('你好呀。今天好吗？',true),[])
 assert.throws(()=>feed.update('换个回答。',true),/修订/)
 const tail=createSentenceFeed();assert.deepEqual(tail.update('没标点也可以',true),['没标点也可以'])
})
test('early speech uses a meaningful first clause, preserves words, and does not split numbers or short greetings',()=>{
 const feed=createSentenceFeed({earlyFirstClause:true})
 assert.deepEqual(feed.update('爸爸，今天外面的天气还挺好的，'),['爸爸，今天外面的天气还挺好的，'])
 assert.deepEqual(feed.update('爸爸，今天外面的天气还挺好的，咱们可以聊两句。'),['咱们可以聊两句。'])
 const greeting=createSentenceFeed({earlyFirstClause:true});assert.deepEqual(greeting.update('爸爸，'),[])
 const number=createSentenceFeed({earlyFirstClause:true});assert.deepEqual(number.update('今天一共需要支付1,234元'),[])
})
