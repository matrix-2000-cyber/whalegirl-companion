import test from 'node:test'
import assert from 'node:assert/strict'
import {paidVoiceScript} from '../public/paid-voice-script.mjs'
test('paid vocal sounds do not read the old syllables a second time',()=>{
  assert.equal(paidVoiceScript('哈哈哈',{clip:'laugh_1',spoken:''}),'(chuckle)')
  assert.equal(paidVoiceScript('唉……',{clip:'sigh_1',spoken:''}),'(sighs)')
  assert.equal(paidVoiceScript('呜呜',{clip:'cry_1',spoken:''}),'(crying)')
  assert.equal(paidVoiceScript('哈哈，真有趣',{clip:'laugh_1',spoken:'真有趣'}),'(chuckle) 真有趣')
})
