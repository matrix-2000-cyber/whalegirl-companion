import test from 'node:test'
import assert from 'node:assert/strict'
import {chooseFamilyTopic,familyTopics,initiativePrompt} from '../initiative.mjs'
test('topic rotation covers the full pool without repeating recent family interactions',()=>{
 const jobs=[],chosen=[]
 for(let i=0;i<24;i++){
  const topic=chooseFamilyTopic(jobs)
  assert.ok(!chosen.slice(-5).includes(topic.id))
  jobs.push({created:i,interactionTopic:topic.id});chosen.push(topic.id)
 }
 assert.equal(new Set(chosen.slice(0,8)).size,familyTopics.length)
 assert.equal(chooseFamilyTopic([...jobs].reverse()).id,chooseFamilyTopic(jobs).id)
})
test('family interaction cues cannot turn a friend into the father',()=>{
 const topic=familyTopics.find(t=>t.id==='listen-story')
 assert.match(initiativePrompt('idle',false,{owner:true,topic}),/爸爸给鲸鲸讲个故事/)
 assert.doesNotMatch(initiativePrompt('idle',false,{owner:false,topic}),/本轮可选的小由头/)
})
