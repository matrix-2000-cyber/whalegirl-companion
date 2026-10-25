import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClipReader} from '../server.mjs'
import {isOnlyVocalSound} from '../public/voice-emotion.mjs'
test('recorded effects resolve for both free voice styles with matching provenance',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../bridge-src/assets/voice-clips/manifest.json',import.meta.url)))
 const reader=createClipReader()
 for(const style of ['cute','gentle'])for(const name of ['laugh_1','cry_1','sigh_1']){
  const entry=manifest.clips.find(c=>c.style===style&&c.name===name)
  assert.equal(entry.license,'CC0-1.0');assert.equal(entry.recording,'human-performance')
  assert.ok(entry.ms>300&&entry.ms<3000)
  assert.equal(reader.read(style,name).length,entry.bytes)
 }
})
test('pure laugh and sob use a clip alone while real words retain speech',()=>{
 assert.equal(isOnlyVocalSound('哈哈哈！','laugh_1'),true)
 assert.equal(isOnlyVocalSound('呜呜😭','cry_1'),true)
 assert.equal(isOnlyVocalSound('唉……','sigh_1'),true)
 assert.equal(isOnlyVocalSound('哈哈，真开心！','laugh_1'),false)
})
